import os
import re
import json
import shutil
import logging
import traceback
import asyncio
import concurrent.futures
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union

import aiofiles
import aiohttp
import numpy as np
import pandas as pd
import requests
import seaborn as sns
import matplotlib
import matplotlib.pyplot as plt
from dotenv import load_dotenv
from PIL import Image
from pathlib import Path

# ---- Bibliothèque Rich pour l'affichage CLI en direct ----
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live

# ---- Selenium ----
from selenium.webdriver.chrome.service import Service
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from collections import defaultdict, Counter
from itertools import combinations

# Pour le backend matplotlib "headless"
matplotlib.use('Agg')

# Configuration du logger global
logger = logging.getLogger()
logger.setLevel(logging.ERROR)

# Chargement des variables d’environnement
load_dotenv()

# Stockage global des clients par défaut
client_options = [{"value": -1, "name": "Sélectionner un élément..."}]

# Concurrence configurable
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("VA_MAX_CONCURRENT", "20"))
MAX_CONVERT_WORKERS = os.cpu_count() or 1


# ----------------------------------------------------------------
#     1) Divers : update_clients_json, connexion Selenium
# ----------------------------------------------------------------
def update_clients_json(client_name: str) -> None:
    """
    Met à jour le fichier clients.json pour ajouter un client
    sous forme "Client_Name" (avec underscores).

    Paramètres
    ----------
    client_name : str
        Nom du client, ex: "Total Energies"
    """
    clients_file = Path('./data/clients.json')
    cname_underscore = client_name.replace(' ', '_')

    try:
        if clients_file.exists():
            with clients_file.open('r', encoding='utf-8') as f:
                data = json.load(f)

            if not isinstance(data, dict) or 'clients' not in data or not isinstance(data['clients'], list):
                data = {"clients": []}
        else:
            data = {"clients": []}

        if cname_underscore not in data["clients"]:
            data["clients"].append(cname_underscore)
            data["clients"].sort()
            with clients_file.open('w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            logger.info("Client '%s' ajouté dans clients.json.", cname_underscore)
        else:
            logger.info("Client '%s' déjà présent dans clients.json.", cname_underscore)

    except Exception as e:
        logging.error(f"Erreur update_clients_json: {e}")


def login_and_get_session_data() -> Optional[Dict[str, Any]]:
    """
    Ouvre une session Selenium headless sur https://www.vassestockage.fr/index.aspx,
    identifie l’utilisateur via VA_SITE_USERNAME / VA_SITE_PASSWORD,
    puis renvoie un dictionnaire avec le driver Selenium si connexion réussie.

    Retour
    ------
    Optional[Dict[str, Any]]
        Un dict de la forme {"driver": <webdriver>} si succès, None sinon.
    """
    username = os.getenv('VA_SITE_USERNAME')
    password = os.getenv('VA_SITE_PASSWORD')

    if not username or not password:
        logger.error("VA_SITE_USERNAME / VA_SITE_PASSWORD non définies.")
        return None

    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--window-size=1920,1080')

    # ⚠️ CHANGEMENT MAJEUR ICI  (référence ligne (A) originale)
    #        driver = webdriver.Chrome(options=chrome_options)
    # ───▶
    driver = webdriver.Chrome(service=Service(), options=chrome_options)
    # Selenium Manager télécharge le bon driver (signé/notarisé).
    login_url = "https://www.vassestockage.fr/index.aspx"
    driver.maximize_window()

    try:
        driver.get(login_url)
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        login_field = WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "txt_login")))
        pwd_field = WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "txt_pwd")))

        login_field.send_keys(username)
        pwd_field.send_keys(password)

        btn = WebDriverWait(driver, 20).until(EC.element_to_be_clickable((By.ID, "btn_login")))
        btn.click()

        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.XPATH, "//meta[@property='wb-token']")))

        return {"driver": driver}

    except Exception as ex:
        logger.error(f"Erreur connexion: {ex}")
        driver.quit()
        return None


def retrieve_clients_from_select(driver: webdriver.Chrome) -> List[Dict[str, Any]]:
    """
    Récupère la liste des clients depuis l’option <select> du site,
    puis renvoie la liste au format :
        [{"value": -1, "name": "Sélectionner un..."},
         {"value": 10, "name": "CLT_ABC"}, ...]

    Paramètres
    ----------
    driver : webdriver.Chrome
        Instance selenium déjà connectée et authentifiée.

    Retour
    ------
    List[Dict[str, Any]]
        Liste de dicts pour décrire chaque client.
    """
    WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    mnu_invent = WebDriverWait(driver, 30).until(EC.element_to_be_clickable((By.ID, "mnu_id_4")))
    mnu_invent.click()

    sel_client = WebDriverWait(driver, 30).until(EC.element_to_be_clickable((By.ID, "sel_client")))
    options = sel_client.find_elements(By.TAG_NAME, "option")

    current_list = [
        (opt.get_attribute("value"), opt.text.strip())
        for opt in options if opt.get_attribute("value") != "-1"
    ]

    dynamic = [{"value": -1, "name": "Sélectionner un..."}] + [
        {"value": int(v), "name": n} for v, n in current_list
    ]
    return dynamic


def get_wb_token(driver: webdriver.Chrome) -> Optional[str]:
    """
    Extrait le wb-token depuis la balise <meta property='wb-token'> du site.

    Paramètres
    ----------
    driver : webdriver.Chrome
        Instance du driver Selenium.

    Retour
    ------
    Optional[str]
        Le token si trouvé, None sinon.
    """
    try:
        meta = driver.find_element(By.XPATH, "//meta[@property='wb-token']")
        return meta.get_attribute("content")
    except Exception:
        return None


def get_session_cookies(driver: webdriver.Chrome) -> Dict[str, str]:
    """
    Convertit la liste de cookies Selenium en dict {nom_cookie: valeur_cookie}.

    Paramètres
    ----------
    driver : webdriver.Chrome

    Retour
    ------
    Dict[str, str]
        Cookies format dict pour usage avec requests ou aiohttp.
    """
    cookies_list = driver.get_cookies()
    return {c['name']: c['value'] for c in cookies_list}


# ----------------------------------------------------------------
#     2) Utilitaires : sanitize_filename + build_live_table
# ----------------------------------------------------------------
def sanitize_filename(name: str) -> str:
    """
    Remplace dans la chaîne de caractères les caractères problématiques
    par un underscore : espaces, points, parenthèses, etc.

    Paramètres
    ----------
    name : str
        Nom initial.

    Retour
    ------
    str
        Nom nettoyé
    """
    chars_to_replace = [' ', '.', '(', ')', '"', '#', '!', '/', '\\']
    for ch in chars_to_replace:
        name = name.replace(ch, '_')
    return name


def build_live_table(client_name: str, tasks: List[Dict[str, Any]]) -> Panel:
    """
    Construit un objet Panel contenant un tableau Rich
    pour lister les tâches, la progression (ex: "50/100 (50.0%)")
    et l'emoji Fait (✅ ou ❌).

    Paramètres
    ----------
    client_name : str
        Nom du client.
    tasks : List[Dict[str, Any]]
        Liste de tâches, chaque dict contenant au minimum
        {"task_name":..., "progress":..., "ok": bool}.

    Retour
    ------
    Panel
        Le panel Rich prêt à être affiché.
    """
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Tâche", justify="left", style="white")
    table.add_column("Progression", justify="center", style="cyan")
    table.add_column("Fait", justify="center", style="green")

    for t in tasks:
        is_done = t.get("ok", t.get("done", False))
        check_emoji = "✅" if is_done else "❌"
        task_name = t.get("task_name", t.get("name", "Unknown Task"))
        progress = t.get("progress", "")
        table.add_row(task_name, progress, check_emoji)

    title_str = f"[bold yellow]{client_name}[/bold yellow]"
    panel = Panel.fit(table, title=title_str, border_style="blue")
    return panel


def set_task_progress(tasks: List[Dict[str, Any]], index: int, done: int, total: int) -> None:
    percent = (done / total) * 100 if total else 100
    tasks[index]["progress"] = f"{done}/{total} ({percent:.1f}%)"


# ----------------------------------------------------------------
#     3) Fonctions "métier" : Inventaire, Téléchargement, etc.
# ----------------------------------------------------------------
def retrieve_initial_data_with_client(session_data: Dict[str, Any], cid: int) -> Optional[pd.DataFrame]:
    """
    Récupère les données d’inventaire du client choisi, via requests sur l’endpoint :
    https://www.vassestockage.fr//ajax/ajax.aspx/fnc_selectInventaire

    Paramètres
    ----------
    session_data : Dict[str, Any]
        Doit contenir {"driver": <webdriver>}.
    cid : int
        ID du client.

    Retour
    ------
    Optional[pd.DataFrame]
        Le DataFrame d’inventaire si succès, None sinon.
    """
    driver = session_data['driver']
    wb_token = get_wb_token(driver)
    cookies = get_session_cookies(driver)

    if not wb_token or not cookies:
        return None

    url = 'https://www.vassestockage.fr//ajax/ajax.aspx/fnc_selectInventaire'
    headers = {
        'Host': 'www.vassestockage.fr',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json; charset=utf-8',
        'wb-token': wb_token,
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.vassestockage.fr',
        'Referer': 'https://www.vassestockage.fr/main.aspx',
    }
    payload = {
        "i_usr_id": "15",
        "i_cli_id": str(cid),
        "s_prod_designation": "",
        "s_code_barre": "",
        "s_prod_ref_interne": "",
        "i_cli_multi_site": "1",
        "i_usr_admin_site": "1",
        "i_sit_id": "-1"
    }

    try:
        with requests.Session() as s:
            s.headers.update(headers)
            s.cookies.update(cookies)
            r = s.post(url, json=payload)
            r.raise_for_status()

            data = json.loads(r.json().get('d', '{}'))
            if not data:
                return pd.DataFrame()

            if isinstance(data, list):
                return pd.DataFrame(data)
            elif isinstance(data, dict):
                # Si c'est un dict, on l'enveloppe dans une liste
                return pd.DataFrame([data])
            else:
                logger.error(f"Unexpected data format in retrieve_inventaire: {type(data)}")
                return pd.DataFrame()

    except Exception as ex:
        logger.error(f"Err retrieve_inventaire: {ex}")
        return None


def process_inventory_data(df_inv: pd.DataFrame) -> pd.DataFrame:
    """
    Exécute quelques nettoyages sur le DataFrame d’inventaire, par ex:
    - Remplacement des espaces et slash dans 'prod_designation' par underscores
    - Appel à sanitize_filename

    Paramètres
    ----------
    df_inv : pd.DataFrame
        Données d’inventaire.

    Retour
    ------
    pd.DataFrame
        DataFrame transformé.
    """
    try:
        df_inv['prod_designation'] = (
            df_inv['prod_designation']
            .astype(str)
            .str.replace(' ', '_')
            .str.replace('/', '_')
        )
        df_inv['prod_designation'] = df_inv['prod_designation'].apply(sanitize_filename)
        return df_inv
    except Exception as ex:
        logger.error(f"Erreur process_inventory_data: {ex}")
        return df_inv


async def download_images_for_subset(
    df_sub: pd.DataFrame,
    images_dir: Union[str, Path],
    tasks: List[Dict[str, Any]],
    index_task: int,
    live: Live,
    client_name: str
) -> None:
    """
    Télécharge toutes les images pour un sous-ensemble de produits (df_sub).
    Mise à jour de tasks[index_task]["progress"] en direct,
    via l’objet Live de Rich.

    Paramètres
    ----------
    df_sub : pd.DataFrame
        Sous-ensemble de l’inventaire.
    images_dir : Union[str, Path]
        Répertoire de sortie des images.
    tasks : List[Dict[str, Any]]
        Liste de dictionnaires de tâches pour affichage progressif.
    index_task : int
        Index de la tâche correspondante dans tasks.
    live : Live
        Objet Live de Rich pour mise à jour en temps réel.
    client_name : str
        Nom du client (affichage).
    """
    images_path = Path(images_dir)
    images_path.mkdir(parents=True, exist_ok=True)

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
    total = len(df_sub)
    done = 0

    set_task_progress(tasks, index_task, 0, total)
    tasks[index_task]["ok"] = False
    live.update(build_live_table(client_name, tasks))

    async with aiohttp.ClientSession() as session:

        async def dl_one(row):
            nonlocal done
            async with semaphore:
                photo = row.get('photo', '')
                if not photo or pd.isna(photo):
                    done += 1
                else:
                    url = f"https://www.vassestockage.fr/{photo}"
                    fname = f"{row['prod_designation']}.jpg"
                    outpath = images_path / fname
                    try:
                        async with session.get(url) as resp:
                            if resp.status == 200:
                                content = await resp.read()
                                async with aiofiles.open(outpath, 'wb') as f:
                                    await f.write(content)
                    except Exception as ex:
                        logger.error(f"Exc telech {url}: {ex}")

                    done += 1

                set_task_progress(tasks, index_task, done, total)
                live.update(build_live_table(client_name, tasks))
                await asyncio.sleep(0)  # Laisser la boucle de rafraîchissement agir

        tasks_dl = [dl_one(r) for _, r in df_sub.iterrows()]
        await asyncio.gather(*tasks_dl)

    tasks[index_task]["ok"] = True
    live.update(build_live_table(client_name, tasks))


def convert_one_image(args: tuple) -> None:
    """
    Convertit une image JPEG en WebP avec qualité 80.

    Paramètres
    ----------
    args : tuple
        (src_dir, dst_dir, filename)
    """
    src_dir, dst_dir, f = args
    src_path = Path(src_dir) / f
    if not src_path.exists():
        return

    webp_name = Path(f).stem + ".webp"
    dst_path = Path(dst_dir) / webp_name

    try:
        with Image.open(src_path) as img:
            img.save(dst_path, 'WEBP', quality=80)
    except Exception as ex:
        logger.error(f"Erreur conv {f}: {ex}\n{traceback.format_exc()}")


def convert_images_to_webp_diff(
    df_sub: pd.DataFrame,
    images_dir: Union[str, Path],
    webp_dir: Union[str, Path],
    tasks: List[Dict[str, Any]],
    index_task: int,
    live: Live,
    client_name: str
) -> None:
    """
    Convertit en WebP toutes les images .jpg référencées dans df_sub
    (colonne 'prod_designation').

    Paramètres
    ----------
    df_sub : pd.DataFrame
        Sous-ensemble de l’inventaire.
    images_dir : Union[str, Path]
        Répertoire source contenant les .jpg.
    webp_dir : Union[str, Path]
        Répertoire de sortie (WebP).
    tasks : List[Dict[str, Any]]
        Liste de dictionnaires de tâches pour affichage progressif.
    index_task : int
        Index de la tâche dans tasks.
    live : Live
        Objet Live de Rich pour mise à jour en direct.
    client_name : str
        Nom du client (affichage).
    """
    images_path = Path(images_dir)
    webp_path = Path(webp_dir)

    webp_path.mkdir(parents=True, exist_ok=True)
    to_convert = []

    for _, row in df_sub.iterrows():
        f_jpg = f"{row['prod_designation']}.jpg"
        if (images_path / f_jpg).exists():
            to_convert.append(f_jpg)

    total = len(to_convert)
    done = 0

    set_task_progress(tasks, index_task, 0, total)
    tasks[index_task]["ok"] = False
    live.update(build_live_table(client_name, tasks))

    with concurrent.futures.ProcessPoolExecutor(max_workers=MAX_CONVERT_WORKERS) as executor:
        file_args = [(images_path, webp_path, x) for x in to_convert]
        futures = [executor.submit(convert_one_image, fa) for fa in file_args]

        for fut in concurrent.futures.as_completed(futures):
            _ = fut.result()
            done += 1
            set_task_progress(tasks, index_task, done, total)
            live.update(build_live_table(client_name, tasks))

    tasks[index_task]["ok"] = True
    live.update(build_live_table(client_name, tasks))


# ----------------------------------------------------------------
#     3bis) Fonction modifiée : retrieve_history_for_subset
# ----------------------------------------------------------------
async def retrieve_history_for_subset(
    session_data: Dict[str, Any],
    selected_cli_id: int,
    df_sub: pd.DataFrame,
    tasks: List[Dict[str, Any]],
    index_task: int,
    live: Live,
    client_name: str,
    outdir: Union[str, Path]
) -> pd.DataFrame:
    """
    Récupération asynchrone de l'historique + volume de stock pour chaque produit
    dans df_sub. Appels successifs aux endpoints :
    - fnc_selectHistoArticles
    - fnc_selectStockProduit

    Mise à jour en direct dans tasks[index_task], et
    création d'un fichier stock_volume.json dans outdir.

    Paramètres
    ----------
    session_data : Dict[str, Any]
        Session Selenium + cookies.
    selected_cli_id : int
        ID du client.
    df_sub : pd.DataFrame
        Sous-ensemble de l’inventaire (col. 'prod_id', 'prod_designation', etc.).
    tasks : List[Dict[str, Any]]
        Liste de tâches (progression).
    index_task : int
        Index de la tâche correspondante dans tasks.
    live : Live
        Objet Live pour l’affichage dynamique.
    client_name : str
        Nom du client (pour l’affichage).
    outdir : Union[str, Path]
        Répertoire de sortie (stock_volume.json sera créé ici).

    Retour
    ------
    pd.DataFrame
        Le DataFrame fusionné de l’historique (avec stock_volume) pour les produits visés.
    """
    if session_data is None or df_sub.empty:
        tasks[index_task]["progress"] = "0/0 (0.0%)"
        tasks[index_task]["ok"] = False
        live.update(build_live_table(client_name, tasks))
        return pd.DataFrame()

    driver = session_data['driver']
    wb_token = get_wb_token(driver)
    cookies = get_session_cookies(driver)

    if not wb_token or not cookies:
        tasks[index_task]["progress"] = "0/0 (0.0%)"
        tasks[index_task]["ok"] = False
        live.update(build_live_table(client_name, tasks))
        return pd.DataFrame()

    df_sub = df_sub.drop_duplicates(subset=['prod_id']).copy()
    products = df_sub[['prod_id', 'prod_designation']].to_dict('records')
    total = len(products)
    done = 0

    set_task_progress(tasks, index_task, 0, total)
    tasks[index_task]["ok"] = False
    live.update(build_live_table(client_name, tasks))

    results = []
    stock_data: Dict[str, Dict[str, Any]] = {}

    url_history = 'https://www.vassestockage.fr//ajax/ajax.aspx/fnc_selectHistoArticles'
    url_stock = 'https://www.vassestockage.fr//ajax/ajax.aspx/fnc_selectStockProduit'
    headers = {
        'wb-token': wb_token,
        'Content-Type': 'application/json; charset=utf-8',
    }
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)

    async with aiohttp.ClientSession(cookies=cookies) as session:

        async def fetch_all(prod_id, pdes):
            nonlocal done

            async with semaphore:
                # 1) Historique
                payload_history = {
                    "i_usr_id": "15",
                    "i_prod_id": str(prod_id),
                    "i_prod_sit_id": "-1",
                    "i_cli_id": str(selected_cli_id)
                }
                df_h = pd.DataFrame()

                try:
                    async with session.post(url_history, json=payload_history, headers=headers) as resp:
                        if resp.status == 200:
                            j = await resp.json()
                            data_h = json.loads(j.get("d", "[]"))
                            if isinstance(data_h, dict):
                                data_h = [data_h]
                            if data_h:
                                df_h = pd.DataFrame(data_h)
                                if not df_h.empty:
                                    df_h['prod_designation'] = pdes
                                    df_h['prod_id'] = prod_id
                except Exception as ex:
                    logger.error(f"Erreur retrieveHistory {pdes} : {ex}")

                # 2) Stock
                payload_stock = {
                    "i_usr_id": "15",
                    "i_prod_id": str(prod_id),
                    "i_prod_sit_id": "-1"
                }
                stock_volume = None
                try:
                    async with session.post(url_stock, json=payload_stock, headers=headers) as resp:
                        if resp.status == 200:
                            j = await resp.json()
                            data_s_raw = j.get("d", None)
                            if data_s_raw is not None:
                                try:
                                    list_rows = json.loads(data_s_raw)
                                    if list_rows:
                                        stock_volume = float(list_rows[0].get("stock_volume", 0))
                                        logger.debug("prod_id=%s, stock_volume=%s", prod_id, stock_volume)
                                    else:
                                        logger.debug("prod_id=%s, tableau vide => stock_volume=None", prod_id)
                                except (ValueError, json.JSONDecodeError) as e:
                                    stock_volume = None
                                    logger.debug("prod_id=%s, data_s mal formé => %s", prod_id, e)
                            else:
                                logger.debug("prod_id=%s, data_s is None", prod_id)
                        else:
                            logger.debug("prod_id=%s, HTTP status=%s", prod_id, resp.status)

                        stock_data[str(prod_id)] = {
                            "prod_designation": pdes,
                            "stock_volume": stock_volume
                        }
                except Exception as ex:
                    logger.error(f"Erreur retrieveStock {pdes} : {ex}")

                # 3) Fusion
                if df_h.empty:
                    df_h = pd.DataFrame([{
                        "prod_id": prod_id,
                        "prod_designation": pdes
                    }])

                df_h['stock_volume'] = stock_volume
                results.append(df_h)

            # Avancement
            done += 1
            percent = (done / total) * 100 if total > 0 else 100
            tasks[index_task]["progress"] = f"{done}/{total} ({percent:.1f}%)"
            live.update(build_live_table(client_name, tasks))
            await asyncio.sleep(0)  # Laisser la boucle de rafraîchissement agir

        # Lancement asynchrone de toutes les requêtes
        tasks_all = [fetch_all(p['prod_id'], p['prod_designation']) for p in products]
        await asyncio.gather(*tasks_all)

    # Sauvegarde du dictionnaire "stock_data" dans stock_volume.json
    try:
        stock_list = []
        for pid_str, data_dict in stock_data.items():
            stock_list.append({
                "prod_id": pid_str,
                "prod_designation": data_dict["prod_designation"],
                "stock_volume": data_dict["stock_volume"]
            })

        out_path = Path(outdir)
        out_path.mkdir(parents=True, exist_ok=True)
        json_file = out_path / "stock_volume.json"

        stock_result_json = {
            "metadata": {
                "client_name": client_name,
                "client_id": selected_cli_id,
                "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            },
            "data": stock_list
        }

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(stock_result_json, f, ensure_ascii=False, indent=2)
        logger.info(f"Fichier stock_volume.json créé dans : {json_file}")

    except Exception as e:
        logger.error(f"Impossible de sauvegarder stock_volume.json : {e}")

    tasks[index_task]["ok"] = True
    live.update(build_live_table(client_name, tasks))

    if results:
        filtered_results = [df for df in results if not df.empty]
        if filtered_results:
            return pd.concat(filtered_results, ignore_index=True)
        return pd.DataFrame()
    return pd.DataFrame()


def clean_history(df_history: pd.DataFrame) -> pd.DataFrame:
    """
    Nettoie le DataFrame d’historique :
    - Convertit la date en datetime (format jj/mm/aaaa).
    - Supprime les lignes "NON DEFINI".
    - Gère le site "COLOMBES" si empl_libelle commence par STOCK.

    Paramètres
    ----------
    df_history : pd.DataFrame

    Retour
    ------
    pd.DataFrame
        Le DataFrame nettoyé.
    """
    if 'empprod_date_insert' in df_history.columns:
        df_history['empprod_date_insert'] = pd.to_datetime(
            df_history['empprod_date_insert'],
            dayfirst=True,
            errors='coerce'
        ).dt.strftime('%d/%m/%Y')

    if 'empl_libelle' in df_history.columns:
        df_history = df_history[~df_history['empl_libelle'].str.contains("NON DEFINI", case=False, na=False)].copy()

    if 'sit_nom' in df_history.columns and 'empl_libelle' in df_history.columns:
        df_history['sit_nom'] = df_history.apply(
            lambda x: "COLOMBES" if pd.isnull(x.get('sit_nom'))
            and str(x.get('empl_libelle', '')).startswith("STOCK")
            else x.get('sit_nom'),
            axis=1
        )

    return df_history


def update_merged_history_for_client(client: Dict[str, Any], history_df: pd.DataFrame) -> bool:
    """
    Met à jour un fichier CSV fusionné (merged_history.csv) pour un client spécifique.
    - Supprime les anciennes lignes du client (via son CLIENT_ID)
    - Ajoute les nouvelles données

    Paramètres
    ----------
    client : Dict[str, Any]
        Au minimum : {'name': <nom_client>, 'value': <id_client>}
    history_df : pd.DataFrame
        Nouvelles données d'historique pour ce client.

    Retour
    ------
    bool
        True si la mise à jour a fonctionné, False sinon.
    """
    console = Console()
    client_name = client['name']
    client_id = client['value']

    data_dir = Path("data")
    merged_file = data_dir / "merged_history.csv"

    df_with_client = history_df.copy()
    df_with_client['CLIENT'] = client_name
    df_with_client['CLIENT_ID'] = client_id

    ordered_columns = [
        'prod_designation', 'art_id', 'art_code_barre', 'empprod_date_insert',
        'empprod_sortie', 'CLIENT', 'sit_nom', 'empl_libelle', 'site_origine',
        'etat_mob_libelle', 'art_commentaire', 'auteur_mouvement', 'usr_validateur',
        'nb_anomalie', 'art_est_piece_detachee', 'prod_id', 'empl_id', 'empl_code_barre',
        'empl_code_postal', 'cli_id', 'cli_raison_sociale', 'CLIENT_ID', 'stock_volume'
    ]
    for col in ordered_columns:
        if col not in df_with_client.columns:
            df_with_client[col] = None

    # Nettoyage des underscores initiaux
    if 'prod_designation' in df_with_client.columns:
        df_with_client['prod_designation'] = (
            df_with_client['prod_designation']
            .astype(str)
            .str.lstrip('_')
            .str.replace('_', ' ')
        )

    # Forcer quelques colonnes en int
    int_cols = [
        "CLIENT_ID", "cli_id", "prod_id", "empl_id", "art_id",
        "nb_anomalie", "empl_code_postal", "art_est_piece_detachee"
    ]
    for col in int_cols:
        if col in df_with_client.columns:
            df_with_client[col] = df_with_client[col].fillna(0).astype(int)

    df_with_client = df_with_client[ordered_columns]

    # 1) Si le fichier CSV n'existe pas, on le crée
    if not merged_file.exists():
        try:
            df_with_client.to_csv(merged_file, index=False)
            print(f"✅ Création d'un nouveau fichier fusionné : {merged_file}")
            return True
        except Exception as e:
            print(f"❌ Erreur lors de la création du fichier CSV : {e}")
            return False

    # 2) Fichier existant : lecture + suppression des anciennes lignes du client
    try:
        merged_df = pd.read_csv(merged_file)
        if 'CLIENT_ID' in merged_df.columns:
            merged_df = merged_df[merged_df['CLIENT_ID'] != client_id]

        updated_df = pd.concat([merged_df, df_with_client], ignore_index=True)

        for col in ordered_columns:
            if col not in updated_df.columns:
                updated_df[col] = None
        updated_df = updated_df[ordered_columns]

        for col in int_cols:
            if col in updated_df.columns:
                updated_df[col] = updated_df[col].fillna(0).astype(int)

        updated_df.to_csv(merged_file, index=False)
        print(f"✅ Mise à jour du fichier fusionné avec les données de {client_name}")
        return True

    except Exception as e:
        print(f"❌ Erreur lors de la mise à jour du fichier CSV : {e}")
        return False


def merge_all_history_files(client_list: List[Dict[str, Any]]) -> None:
    """
    Fusionne tous les fichiers history.csv des différents clients en un seul CSV "merged_history.csv".
    Affiche une barre de progression avec Rich.

    Paramètres
    ----------
    client_list : List[Dict[str, Any]]
        Liste des clients sous forme de dicts {"name":..., "value":...}.
    """
    from rich.console import Console
    from rich.live import Live

    console = Console()
    tasks = [
        {"name": "Collecte des fichiers", "done": False, "status": "En cours", "progress": "0/0 (0.0%)"},
        {"name": "Fusion des données", "done": False, "status": "En attente", "progress": "0/0 (0.0%)"},
        {"name": "Export Excel", "done": False, "status": "En attente", "progress": "0/0 (0.0%)"}
    ]

    with Live(build_live_table("Fusion des Historiques", tasks), console=console, refresh_per_second=4) as live:
        all_history_dfs = []
        valid_clients = []
        failed_clients = []
        available_files = []

        # 1) Récupérer la liste des fichiers history.csv
        for client in client_list:
            client_name = client['name']
            sanitized_name = client_name.replace(' ', '_')
            history_path = Path(f"data/{sanitized_name}/history.csv")
            if history_path.exists():
                available_files.append((client, history_path))

        total_files = len(available_files)
        if total_files == 0:
            tasks[0]["status"] = "Terminé"
            tasks[0]["progress"] = "0/0 (0.0%)"
            tasks[0]["done"] = True
            live.update(build_live_table("Fusion des Historiques", tasks))
            console.print("\nAucun fichier history.csv trouvé.")
            return

        # 2) Lecture des fichiers
        for idx, (client, history_path) in enumerate(available_files):
            client_name = client['name']
            try:
                df_history = pd.read_csv(history_path)
                df_history['CLIENT'] = client_name
                df_history['CLIENT_ID'] = client['value']
                all_history_dfs.append(df_history)

                progress_pct = (idx + 1) / total_files * 100
                tasks[0]["progress"] = f"{idx + 1}/{total_files} ({progress_pct:.1f}%)"
                tasks[0]["status"] = f"Traitement de {client_name}"
                live.update(build_live_table("Fusion des Historiques", tasks))

            except Exception as e:
                failed_clients.append(client_name)
                progress_pct = (idx + 1) / total_files * 100
                tasks[0]["progress"] = f"{idx + 1}/{total_files} ({progress_pct:.1f}%)"
                tasks[0]["status"] = f"Erreur avec {client_name}: {str(e)[:30]}..."
                live.update(build_live_table("Fusion des Historiques", tasks))

        tasks[0]["done"] = True
        tasks[0]["status"] = "Terminé"
        live.update(build_live_table("Fusion des Historiques", tasks))

        if not all_history_dfs:
            tasks[1]["status"] = "Annulé"
            tasks[1]["done"] = True
            tasks[2]["status"] = "Annulé"
            tasks[2]["done"] = True
            live.update(build_live_table("Fusion des Historiques", tasks))
            console.print("Aucune donnée valide trouvée dans les fichiers history.csv.")
            return

        # 3) Fusion des DataFrames
        tasks[1]["status"] = "En cours"
        live.update(build_live_table("Fusion des Historiques", tasks))

        total_rows = sum(len(df) for df in all_history_dfs)
        merged_df = pd.concat(all_history_dfs, ignore_index=True)

        # Conversion de la date
        if 'empprod_date_insert' in merged_df.columns:
            try:
                merged_df['empprod_date_insert'] = pd.to_datetime(
                    merged_df['empprod_date_insert'],
                    dayfirst=True,
                    errors='coerce'
                ).dt.strftime('%d/%m/%Y')
            except Exception as e:
                console.print(f"[yellow]Avertissement: Conversion date impossible: {e}[/yellow]")

        # Nettoyage prod_designation
        if 'prod_designation' in merged_df.columns:
            merged_df['prod_designation'] = (
                merged_df['prod_designation']
                .astype(str)
                .str.lstrip('_')
                .str.replace('_', ' ')
            )

        # Réorganiser les colonnes
        ordered_columns = [
            'prod_designation', 'art_id', 'art_code_barre', 'empprod_date_insert', 'empprod_sortie',
            'CLIENT', 'sit_nom', 'empl_libelle', 'site_origine', 'etat_mob_libelle', 'art_commentaire',
            'auteur_mouvement', 'usr_validateur', 'nb_anomalie', 'art_est_piece_detachee', 'prod_id',
            'empl_id', 'empl_code_barre', 'empl_code_postal', 'cli_id', 'cli_raison_sociale', 'CLIENT_ID',
            'stock_volume'
        ]
        for col in ordered_columns:
            if col not in merged_df.columns:
                merged_df[col] = None
        merged_df = merged_df[ordered_columns]

        tasks[1]["done"] = True
        tasks[1]["status"] = f"Terminé ({len(merged_df)} lignes)"
        tasks[1]["progress"] = f"{len(merged_df)}/{total_rows} (100.0%)"
        live.update(build_live_table("Fusion des Historiques", tasks))

        # Forcer quelques colonnes en int
        int_cols = [
            "CLIENT_ID", "cli_id", "prod_id", "empl_id", "art_id",
            "nb_anomalie", "empl_code_postal", "art_est_piece_detachee"
        ]
        for col in int_cols:
            if col in merged_df.columns:
                merged_df[col] = merged_df[col].fillna(0).astype(int)

        # 4) Export CSV
        tasks[2]["status"] = "En cours"
        live.update(build_live_table("Fusion des Historiques", tasks))

        data_dir = Path("data")
        output_csv = data_dir / "merged_history.csv"
        if output_csv.exists():
            try:
                output_csv.unlink()
                console.print(f"[blue]Fichier existant supprimé: {output_csv}[/blue]")
            except Exception as e:
                console.print(f"[yellow]Impossible de supprimer le fichier existant: {e}[/yellow]")

        try:
            merged_df.to_csv(output_csv, index=False)
            tasks[2]["done"] = True
            tasks[2]["status"] = "Terminé"
            tasks[2]["progress"] = "1/1 (100.0%)"
            live.update(build_live_table("Fusion des Historiques", tasks))
        except Exception as e:
            tasks[2]["status"] = f"Erreur: {str(e)[:30]}"
            live.update(build_live_table("Fusion des Historiques", tasks))

        # Résumé final
        console.print(f"\n[bold green]Fusion terminée avec succès![/bold green]")
        console.print(f"Fichier créé: [bold]{output_csv}[/bold]")
        console.print(f"Contient [bold]{len(merged_df)}[/bold] lignes de [bold]{len(valid_clients)}[/bold] clients")

        if failed_clients:
            console.print(f"\n[bold yellow]Attention:[/bold yellow] {len(failed_clients)} clients n'ont pas pu être traités:")
            for client in failed_clients:
                console.print(f"  - {client}")


def list_zero_sortie(df_history: pd.DataFrame, output_dir: Union[str, Path]) -> List[str]:
    """
    Crée un CSV listant les produits n’ayant jamais de sortie (empprod_sortie == 'E').

    - Si (df_history['cli_raison_sociale']=='TOTALENERGIES') présent,
      on ne considère que sit_nom=='COLOMBES', sauf s’il y a un pattern 'décharge' etc.
    - Sinon, on considère tout le DataFrame.

    Paramètres
    ----------
    df_history : pd.DataFrame
        Historique complet.
    output_dir : Union[str, Path]
        Répertoire de sortie.

    Retour
    ------
    List[str]
        La liste des products designations ayant zéro sortie.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    if (df_history['cli_raison_sociale'] == 'TOTALENERGIES').any():
        df_col = df_history[df_history['sit_nom'] == 'COLOMBES'].copy()
        if df_col.empty:
            return []
        pattern = r'^\s*(?:décharge|decharge|dons|don|rachat|reprise|achat)\s*$'
        df_col = df_col[~df_col['empl_libelle'].str.contains(pattern, flags=re.IGNORECASE, regex=True, na=False)].copy()
        df_check = df_col
    else:
        df_check = df_history

    cond = df_check.groupby('prod_designation')['empprod_sortie'].apply(lambda x: (x == 'E').all())
    product_list = sorted(cond[cond].index.tolist())

    outpath = output_path / "zero_sortie.csv"
    pd.DataFrame(product_list, columns=['prod_designation']).to_csv(outpath, index=False)

    return product_list


def calculate_taux_utilite(df_history: pd.DataFrame, cli_id: int) -> pd.DataFrame:
    """
    Calcule le taux d'utilité = (Nb sorties / Nb entrées)
    - Filtre potentiellement sur 'sit_nom'=='COLOMBES' si client=10

    Paramètres
    ----------
    df_history : pd.DataFrame
        Historique.
    cli_id : int
        ID du client (10 => TOTALENERGIES ?).

    Retour
    ------
    pd.DataFrame
        DataFrame avec colonnes ['prod_designation','E','S','taux_utilité'].
    """
    needed_cols = {'sit_nom', 'prod_designation', 'empprod_sortie'}
    if not needed_cols.issubset(df_history.columns):
        return pd.DataFrame()

    if cli_id == 10:
        df_site = df_history[df_history['sit_nom'] == 'COLOMBES']
    else:
        df_site = df_history

    counts = df_site.groupby(['prod_designation', 'empprod_sortie']).size().unstack(fill_value=0)
    if 'E' not in counts.columns:
        counts['E'] = 0
    if 'S' not in counts.columns:
        counts['S'] = 0

    counts['taux_utilité'] = round((counts['S'] / counts['E'].replace(0, np.nan)), 2)
    counts.fillna(0, inplace=True)

    return counts[['taux_utilité']].reset_index()


def calculate_obsolescence(df_history: pd.DataFrame) -> pd.DataFrame:
    """
    Calcule pour chaque produit un indice d’obsolescence (en mois) :
    - Si le produit n’a que des E (entrées) => prendre la date min
    - Sinon, si on a des S (sorties), prendre la date max de S
    - Sinon, par défaut, la date min

    Paramètres
    ----------
    df_history : pd.DataFrame

    Retour
    ------
    pd.DataFrame
        Colonnes ['prod_designation','Obsolescence (mois)'].
    """
    df = df_history.copy()
    if 'empprod_date_insert' not in df.columns:
        return pd.DataFrame()

    df['empprod_date_insert'] = pd.to_datetime(df['empprod_date_insert'], errors='coerce', dayfirst=True)
    df.dropna(subset=['empprod_date_insert'], inplace=True)

    products = df['prod_designation'].unique()
    if len(products) == 0:
        return pd.DataFrame()

    rows = []
    today = datetime.now()

    for p in products:
        dfp = df[df['prod_designation'] == p]
        if dfp.empty:
            continue

        # Si que des E
        if (dfp['empprod_sortie'] == 'E').all():
            od = dfp['empprod_date_insert'].min()
            obso = (today.year - od.year) * 12 + (today.month - od.month)
        else:
            df_s = dfp[dfp['empprod_sortie'] == 'S']
            if not df_s.empty:
                latest_s = df_s['empprod_date_insert'].max()
                obso = (today.year - latest_s.year) * 12 + (today.month - latest_s.month)
            else:
                od = dfp['empprod_date_insert'].min()
                obso = (today.year - od.year) * 12 + (today.month - od.month)

        rows.append({'prod_designation': p, 'Obsolescence (mois)': obso})

    return pd.DataFrame(rows)


def prepare_data_for_web(
    df_obso: pd.DataFrame,
    df_util: pd.DataFrame,
    df_inv: pd.DataFrame
) -> pd.DataFrame:
    """
    Fusionne obsolescence, taux d’utilité et inventaire pour générer un DataFrame unique,
    puis prépare la colonne 'image_url' = 'images_webp/<prod_designation>.webp'.

    Paramètres
    ----------
    df_obso : pd.DataFrame
    df_util : pd.DataFrame
    df_inv  : pd.DataFrame

    Retour
    ------
    pd.DataFrame
    """
    if df_obso.empty or df_util.empty or df_inv.empty:
        return pd.DataFrame()

    df_m = df_obso.merge(df_util, on='prod_designation', how='inner')
    df_m = df_m.merge(df_inv, on='prod_designation', how='inner')

    if 'prod_designation' not in df_m.columns:
        return pd.DataFrame()

    df_m['prod_designation'] = df_m['prod_designation'].astype(str)
    df_m['prod_designation'] = (
        df_m['prod_designation']
        .str.replace(' ', '_')
        .str.replace('/', '_')
        .apply(sanitize_filename)
    )
    df_m['image_url'] = 'images_webp/' + df_m['prod_designation'] + '.webp'
    return df_m


def analyze_sorties(df_history: pd.DataFrame, output_dir: Union[str, Path]) -> None:
    """
    Analyse les sorties (S) dans df_history :
    1. Calcule la répartition des sorties par produit (sorties_par_produit_trie.csv).
    2. Construit une matrice de cooccurrence (cooccurrence.json) et une heatmap PNG.

    Paramètres
    ----------
    df_history : pd.DataFrame
        Historique complet.
    output_dir : Union[str, Path]
        Répertoire de sortie (les CSV/PNG/JSON).
    """
    if 'sit_nom' not in df_history.columns:
        return

    def sort_client(df: pd.DataFrame) -> pd.DataFrame:
        """
        Filtre en fonction du client :
        - Si cli_raison_sociale == 'TOTALENERGIES', on ne garde que sit_nom == 'COLOMBES' 
          hors libelle 'décharge|dons|achat'.
        - Sinon, on garde tout, mais seulement les lignes empprod_sortie == 'S'.
        """
        if (df['cli_raison_sociale'] == 'TOTALENERGIES').any():
            dfc = df[df['sit_nom'] == 'COLOMBES']
            if dfc.empty:
                return pd.DataFrame()
            pattern = r'^\s*(?:décharge|decharge|dons|don|rachat|reprise|achat)\s*$'
            dfc = dfc[~dfc['empl_libelle'].str.contains(pattern, flags=re.IGNORECASE, regex=True, na=False)].copy()
            return dfc[dfc['empprod_sortie'] == 'S']
        else:
            return df[df['empprod_sortie'] == 'S']

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    df_S = sort_client(df_history)
    df_S = df_S.copy()
    if df_S.empty:
        return

    totalS = df_S.shape[0]
    if totalS == 0:
        return

    # 1) Sorties par produit
    spp = df_S.groupby('prod_designation').size().reset_index(name='count_S')
    spp['sprod_sur_Stotal'] = np.round(spp['count_S'] / totalS, 8)
    spp2 = spp.sort_values(by='sprod_sur_Stotal', ascending=False).copy()
    spp2['cumulative_sprod_sur_Stotal'] = spp2['sprod_sur_Stotal'].cumsum()
    spp2 = spp2.reset_index(drop=True)

    sp_file = output_path / "sorties_par_produit_trie.csv"
    spp2.to_csv(sp_file, index=False)

    # 2) Cooccurrence ±1j
    df_prods_csv = pd.read_csv(sp_file)
    df_filtered_prods = df_prods_csv[df_prods_csv['cumulative_sprod_sur_Stotal'] <= 0.9]
    cooc_products = sorted(df_filtered_prods['prod_designation'].unique().tolist())
    if len(cooc_products) < 2:
        return

    dates_by_prod = defaultdict(list)
    for _, row in df_S.iterrows():
        p = row['prod_designation']
        try:
            date_obj = pd.to_datetime(row['empprod_date_insert'], format='%d/%m/%Y')
            d = date_obj.date()
            dates_by_prod[p].append(d)
        except Exception as e:
            logging.warning(f"Impossible de convertir la date '{row['empprod_date_insert']}' pour '{p}': {e}")



   # --------------------------------------------------------------
    # 4) Construction optimisée de la matrice de co-occurrence
    # --------------------------------------------------------------
    # a) rang = position dans la liste décroissante de fréquence
    rank = {p: idx for idx, p in enumerate(cooc_products)}

    # b) compteurs
    pair_counts   = defaultdict(Counter)   # pair_counts[pivot][moins_frequent]
    pivot_totals  = Counter()              # nombre de sorties du pivot

    # c) duplication du DataFrame pour inclure ±1 jour
    df_S['date_norm'] = pd.to_datetime(
        df_S['empprod_date_insert'], dayfirst=True
    ).dt.normalize()

    df_aug = pd.concat(
        [df_S.assign(date_aug=df_S['date_norm'] + pd.Timedelta(days=delta))
        for delta in (-1, 0, 1)],
        ignore_index=True
    )

    # d) parcours “par jour”
    for date_val, grp in df_aug.groupby('date_aug'):
        # on ne garde que les produits faisant partie de cooc_products
        prods_all = grp['prod_designation'].unique()
        prods = sorted([p for p in prods_all if p in rank], key=rank.get)

        if len(prods) < 2:
            continue

        # toutes les paires du jour : a = pivot (plus fréquent), b = moins fréquent
        for a, b in combinations(prods, 2):
            if rank[a] < rank[b]:
                pair_counts[a][b] += 1
            else:
                pair_counts[b][a] += 1

        # maj du dénominateur pour chaque pivot présent ce jour-là
        for p in prods:
            pivot_totals[p] += 1

    # e) conversion en matrice asymétrique
    n = len(cooc_products)
    cooc_matrix = [[0.0] * n for _ in range(n)]

    for a, subcounter in pair_counts.items():
        idx_a   = rank[a]
        total_a = pivot_totals[a] if pivot_totals[a] else 1  # sécurité div/0
        for b, c in subcounter.items():
            idx_b = rank[b]
            cooc_matrix[idx_a][idx_b] = round(c / total_a, 4)

    # f) sauvegardes inchangées
    with open(output_path / "cooccurrence.json", "w", encoding="utf-8") as f:
        json.dump(
            {"products": cooc_products, "matrix": cooc_matrix},
            f,
            ensure_ascii=False,
            indent=2
        )

    plt.figure(figsize=(8, 6))
    sns.heatmap(
        cooc_matrix, cmap="viridis", square=True,
        xticklabels=cooc_products, yticklabels=cooc_products
    )
    plt.title("Cooccurrence ±1 j (pivot ➜ moins fréquent)")
    plt.savefig(output_path / "coocurence_heatmap.png")
    plt.close()
    # --------------------------------------------------------------




# ----------------------------------------------------------------
#     5) run_tasks_full (scrape complet, 8 tâches)
# ----------------------------------------------------------------
async def run_tasks_full(
    session_data: Dict[str, Any],
    cid: int,
    client_name: str,
    outdir: Union[str, Path]
) -> List[Dict[str, Any]]:
    """
    Exécute le scraping complet pour un client avec suivi Rich.

    Tâches :
      0 Inventaire
      1 Téléchargement images
      2 Conversion en WebP
      3 Historique + volume unitaire (scrap & clean)
      4 Liste Zéro sortie
      5 Calcul utilité
      6 Calcul obsolescence
      7 Calcul cooccurrence
      8 Sauvegarde inventaire + JSON
    """
    tasks = [
        {"task_name": "Inventaire",                 "progress": "0%",                  "ok": False},
        {"task_name": "Téléchargement images",      "progress": "0/0 (0.0%)",          "ok": False},
        {"task_name": "Conversion en WebP",         "progress": "0/0 (0.0%)",          "ok": False},
        {"task_name": "Historique + volume",        "progress": "0/0 (0.0%)",          "ok": False},
        {"task_name": "Liste Zéro sortie",          "progress": "0%",                  "ok": False},
        {"task_name": "Calcul utilité",             "progress": "0%",                  "ok": False},
        {"task_name": "Calcul obsolescence",        "progress": "0%",                  "ok": False},
        {"task_name": "Calcul cooccurrence",        "progress": "0%",                  "ok": False},
        {"task_name": "Sauvegarde inventaire+JSON", "progress": "0%",                  "ok": False},
    ]

    console   = Console()
    out_path  = Path(outdir)

    with Live(build_live_table(client_name, tasks), console=console, refresh_per_second=4) as live:
        # 0) Inventaire --------------------------------------------------------
        df_inv = retrieve_initial_data_with_client(session_data, cid)
        if df_inv is None or df_inv.empty:
            tasks[0]["progress"] = "0% (vide)"
            tasks[0]["ok"]       = False
            return tasks

        df_inv = process_inventory_data(df_inv)
        tasks[0]["progress"] = "100%"
        tasks[0]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # 1) Téléchargement images -------------------------------------------
        await download_images_for_subset(
            df_sub=df_inv,
            images_dir=out_path / "images",
            tasks=tasks,
            index_task=1,
            live=live,
            client_name=client_name
        )

        # 2) Conversion en WebP ----------------------------------------------
        convert_images_to_webp_diff(
            df_sub=df_inv,
            images_dir=out_path / "images",
            webp_dir=out_path / "images_webp",
            tasks=tasks,
            index_task=2,
            live=live,
            client_name=client_name
        )

        # 3) Historique + volume unitaire ------------------------------------
        df_hist_new = await retrieve_history_for_subset(
            session_data=session_data,
            selected_cli_id=cid,
            df_sub=df_inv,
            tasks=tasks,
            index_task=3,
            live=live,
            client_name=client_name,
            outdir=out_path
        )
        df_hist_new = clean_history(df_hist_new)
        df_hist_new.sort_values(by='empprod_date_insert', inplace=True, na_position='last')

        update_merged_history_for_client({'name': client_name, 'value': cid}, df_hist_new)
        tasks[3]["progress"] = "100%"
        tasks[3]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # 4) Liste Zéro sortie -----------------------------------------------
        list_zero_sortie(df_hist_new, out_path)
        tasks[4]["progress"] = "100%"
        tasks[4]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # 5) Calcul utilité ---------------------------------------------------
        df_util = calculate_taux_utilite(df_hist_new, cid)
        tasks[5]["progress"] = "100%"
        tasks[5]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # 6) Calcul obsolescence ---------------------------------------------
        df_obso = calculate_obsolescence(df_hist_new)
        tasks[6]["progress"] = "100%"
        tasks[6]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # Fusion utilité + obso + inventaire pour data web -------------------
        df_web = prepare_data_for_web(df_obso, df_util, df_inv)

        # 7) Calcul cooccurrence (+ heat-map) --------------------------------
        analyze_sorties(df_hist_new, out_path)
        tasks[7]["progress"] = "100%"
        tasks[7]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

        # Intégration éventuelle du stock volume dans df_web -----------------
        stock_file = out_path / "stock_volume.json"
        if stock_file.exists():
            try:
                with open(stock_file, "r", encoding="utf-8") as f:
                    jstock = json.load(f)
                df_sv = pd.DataFrame(jstock.get("data", []))
                df_sv['prod_id'] = df_sv['prod_id'].astype(str)
                if not df_web.empty and 'prod_id' in df_web.columns:
                    df_web['prod_id'] = df_web['prod_id'].astype(str)
                    df_web = df_web.merge(df_sv[['prod_id', 'stock_volume']], on='prod_id', how='left')
            except Exception as e:
                logger.error(f"Erreur lecture stock_volume.json : {e}")
        elif not df_web.empty:
            df_web['stock_volume'] = None

        if not df_web.empty:
            df_web.to_json(out_path / "data.json", orient='records')

        # 8) Sauvegarde inventaire + JSON ------------------------------------
        if 'prod_designation' in df_hist_new.columns:
            underscore_mask  = df_hist_new['prod_designation'].str.startswith('_', na=False)
            underscore_count = underscore_mask.sum()
            if underscore_count > 0:
                df_hist_new['prod_designation'] = df_hist_new['prod_designation'].str.replace(r'^_+', '', regex=True)

        # Avant la sauvegarde en CSV, ajoutez la colonne 'action'
        df_hist_new = add_action_column(df_hist_new).copy()
        
        # Créer une copie de sauvegarde de la date originale pour le tri
        try:
            # Convertir les dates en format datetime et créer une colonne temporaire pour le tri
            df_hist_new['date_for_sorting'] = pd.to_datetime(df_hist_new['empprod_date_insert'], errors='coerce', dayfirst=True)
            
            # Supprimer les lignes avec dates invalides qui ont été converties en NaT
            invalid_dates = df_hist_new['date_for_sorting'].isna().sum()
            if invalid_dates > 0:
                logger.warning(f"Suppression de {invalid_dates} lignes avec des dates invalides")
                df_hist_new = df_hist_new.dropna(subset=['date_for_sorting'])
                
            # Trier par ordre chronologique complet sur la colonne datetime
            df_hist_new = df_hist_new.sort_values(by='date_for_sorting', ascending=True)
            
            # Créer la colonne au format français jj/mm/aaaa pour l'export
            df_hist_new['empprod_date_insert'] = df_hist_new['date_for_sorting'].dt.strftime('%d/%m/%Y')
            
            # Créer la colonne date_mv au format ISO compatible JavaScript
            df_hist_new['date_mv'] = df_hist_new['date_for_sorting'].dt.strftime('%Y-%m-%dT%H:%M:%S')
            
            # Réorganiser les colonnes pour placer date_mv juste après empprod_date_insert
            cols = df_hist_new.columns.tolist()
            insert_pos = cols.index('empprod_date_insert') + 1
            cols = cols[:insert_pos] + ['date_mv'] + cols[insert_pos:cols.index('date_mv')] + cols[cols.index('date_mv')+1:]
            df_hist_new = df_hist_new[cols]
            
            # Supprimer la colonne temporaire de tri
            df_hist_new = df_hist_new.drop(columns=['date_for_sorting'])
            
            # Vérifier que le tri est correct
            logger.info(f"Tri chronologique effectué avec succès - Premier enregistrement: {df_hist_new['empprod_date_insert'].iloc[0]}, Dernier: {df_hist_new['empprod_date_insert'].iloc[-1]}")
            
        except Exception as e:
            logger.error(f"Erreur lors de la conversion et du tri des dates: {e}")
            # En cas d'erreur, essayer une approche plus simple
            try:
                # Convertir directement au format français jj/mm/aaaa
                df_hist_new['empprod_date_insert'] = pd.to_datetime(df_hist_new['empprod_date_insert'], errors='coerce').dt.strftime('%d/%m/%Y')
                # Ajouter aussi la colonne date_mv au format ISO 8601 dans le bloc d'exception
                df_hist_new['date_mv'] = pd.to_datetime(df_hist_new['empprod_date_insert'], dayfirst=True, errors='coerce').dt.strftime('%Y-%m-%dT%H:%M:%S')
                
                # Réorganiser les colonnes pour placer date_mv juste après empprod_date_insert
                if 'date_mv' in df_hist_new.columns:
                    cols = df_hist_new.columns.tolist()
                    insert_pos = cols.index('empprod_date_insert') + 1
                    if insert_pos < len(cols) and cols[insert_pos] != 'date_mv':
                        cols = cols[:insert_pos] + ['date_mv'] + cols[insert_pos:cols.index('date_mv')] + cols[cols.index('date_mv')+1:]
                        df_hist_new = df_hist_new[cols]
            except Exception as e2:
                logger.error(f"Échec de la conversion des dates, gardant le format original: {e2}")

            
        df_hist_new.to_csv(out_path / "history.csv", index=False)
        df_inv.to_excel(out_path / "inventaire.xlsx", index=False)
        update_clients_json(client_name)

        tasks[8]["progress"] = "100%"
        tasks[8]["ok"]       = True
        live.update(build_live_table(client_name, tasks))

    return tasks



def main_cli() -> None:
    """
    Point d’entrée principal (CLI).
    Utilise argparse pour gérer les options :
    - --scrap-all : exécute run_tasks_full pour tous les clients trouvés
    - --client <NomClient> : exécute pour un client spécifique
    - Mode interactif par défaut si pas d’option.

    Usage (exemples) :
        python script.py --scrap-all
        python script.py --client "TOTALENERGIES"
        python script.py
    """
    import argparse

    parser = argparse.ArgumentParser(description="Scraper complet/partiel avec affichage progressif d'un tableau.")
    parser.add_argument('--scrap-all', action='store_true', help="Scrape complet pour tous les clients.")
    parser.add_argument('--client', help="Client unique.")
    args = parser.parse_args()

    session_data = login_and_get_session_data()
    if session_data is None:
        print("Connexion impossible.")
        return

    driver = session_data['driver']
    global client_options
    client_options = retrieve_clients_from_select(driver)
    valid = [c for c in client_options if c['value'] != -1]

    if not valid:
        print("Aucun client valide.")
        driver.quit()
        return

    if args.scrap_all:
        for c in valid:
            cid = c['value']
            cname = c['name']
            outdir = f"data/{cname.replace(' ', '_')}"

            if Path(outdir).exists():
                shutil.rmtree(outdir)
            Path(outdir).mkdir(parents=True, exist_ok=True)

            asyncio.run(run_tasks_full(session_data, cid, cname, outdir))

        print("\n=== Création du fichier CSV fusionné des historiques ===")
        merge_all_history_files(valid)
        driver.quit()
        return

    if args.client:
        found = next((x for x in valid if x['name'] == args.client), None)
        if not found:
            print(f"Client {args.client} introuvable.")
            driver.quit()
            return

        cid = found['value']
        cname = found['name']
        outdir = f"data/{cname.replace(' ', '_')}"

        if Path(outdir).exists():
            shutil.rmtree(outdir)
        Path(outdir).mkdir(parents=True, exist_ok=True)

        asyncio.run(run_tasks_full(session_data, cid, cname, outdir))
        # Optionnel : fusion globale
        # merge_all_history_files(valid)

        driver.quit()
        return

    # ---- Mode interactif ----
    print("MODE INTERACTIF :")
    for idx, c in enumerate(valid, 1):
        print(f"{idx}. {c['name']}")
    print("Tapez '0' pour Scrap-All, ou 'q' pour quitter.")
    print("Vous pouvez saisir plusieurs numéros séparés par des espaces (ex: 1 2 5).")

    while True:
        user_input = input("\nSélection : ").strip().lower()
        if user_input in ("q", "quit"):
            print("Fermeture...")
            driver.quit()
            return

        parts = user_input.split()
        numbers = []
        for p in parts:
            try:
                n = int(p)
                numbers.append(n)
            except ValueError:
                pass

        if not numbers:
            print("Aucun numéro saisi. Réessayez.")
            continue

        if len(numbers) == 1 and numbers[0] == 0:
            print("=== Mode SCRAP-ALL ===")
            for c in valid:
                cid = c['value']
                cname = c['name']
                outdir = Path(f"data/{cname.replace(' ', '_')}")

                if outdir.exists():
                    shutil.rmtree(outdir)
                outdir.mkdir(parents=True, exist_ok=True)

                asyncio.run(run_tasks_full(session_data, cid, cname, outdir))

            print("\n=== Création du fichier CSV fusionné des historiques ===")
            merge_all_history_files(valid)

        else:
            if 0 in numbers:
                numbers = [x for x in numbers if x != 0]

            max_index = len(valid)
            valid_nums = [x for x in numbers if 1 <= x <= max_index]
            if not valid_nums:
                print("Aucun client valide sélectionné. Réessayez.")
                continue

            valid_nums = sorted(set(valid_nums))
            total_sel = len(valid_nums)

            for i, num in enumerate(valid_nums, start=1):
                c = valid[num - 1]
                cid = c['value']
                cname = c['name']
                outdir = Path(f"data/{cname.replace(' ', '_')}")

                print(f"\n--- Traitement du client {i}/{total_sel} : {cname} (ID={cid}) ---")

                if outdir.exists():
                    shutil.rmtree(outdir)
                outdir.mkdir(parents=True, exist_ok=True)

                asyncio.run(run_tasks_full(session_data, cid, cname, outdir))

        again = input("\nVoulez-vous en traiter d’autres ? (O/N) : ").strip().lower()
        if again not in ("o", "oui"):
            print("Fin du script.")
            driver.quit()
            return
        else:
            print("\nListe des clients :")
            for idx, c in enumerate(valid, 1):
                print(f"{idx}. {c['name']}")
            print("Tapez '0' pour Scrap-All, ou 'q' pour quitter.")

    driver.quit()


def add_action_column(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ajoute une colonne 'action' au DataFrame d'historique.
    Les valeurs possibles sont:
    - C: Création (première entrée pour chaque art_id)
    - E_mv: Entrée dans le cadre d'un mouvement temporaire (même date ou consécutif à une sortie)
    - S_mv: Sortie dans le cadre d'un mouvement temporaire (même date ou suivie d'une entrée)
    - S_def: Sortie définitive (dernière ligne pour un art_id avec empprod_sortie='S')
    
    Paramètres
    ----------
    df : pd.DataFrame
        DataFrame d'historique
        
    Retour
    ------
    pd.DataFrame
        DataFrame avec la colonne 'action' ajoutée
    """
    # Faire une copie pour éviter les modifications en place
    df_copy = df.copy()
    
    # Convertir empprod_date_insert en datetime pour le tri
    if 'empprod_date_insert' in df_copy.columns:
        df_copy['empprod_date_insert'] = pd.to_datetime(
            df_copy['empprod_date_insert'], 
            format='%d/%m/%Y', 
            errors='coerce'
        )
    
    # Initialiser la colonne action (valeur par défaut vide)
    df_copy['action'] = ""
    
    # Trier par art_id et par date
    df_sorted = df_copy.sort_values(by=['art_id', 'empprod_date_insert'])
    
    # Pour chaque art_id, traiter les différents cas
    for art_id, group in df_sorted.groupby('art_id'):
        # 1. Marquer la première entrée comme "C" (création)
        first_idx = group.index[0]
        df_sorted.at[first_idx, 'action'] = "C"
        
        # 2. Traiter les mouvements de même date (E_mv/S_mv)
        # Regrouper par date pour trouver les dates avec entrée et sortie le même jour
        for date, date_group in group.groupby('empprod_date_insert'):
            if len(date_group) >= 2:
                E_rows = date_group[date_group['empprod_sortie'] == 'E']
                S_rows = date_group[date_group['empprod_sortie'] == 'S']
                
                # Si la date contient à la fois une entrée et une sortie
                if not E_rows.empty and not S_rows.empty:
                    for idx in E_rows.index:
                        df_sorted.at[idx, 'action'] = "E_mv"
                    for idx in S_rows.index:
                        df_sorted.at[idx, 'action'] = "S_mv"
        
        # 3. Traiter les mouvements séquentiels (S suivie immédiatement par E)
        for i in range(len(group) - 1):
            current_idx = group.index[i]
            next_idx = group.index[i + 1]
            
            if (df_sorted.at[current_idx, 'empprod_sortie'] == 'S' and 
                df_sorted.at[next_idx, 'empprod_sortie'] == 'E'):
                # Marquer la sortie suivie d'une entrée comme S_mv
                df_sorted.at[current_idx, 'action'] = "S_mv"
                # Marquer l'entrée qui suit une sortie comme E_mv
                df_sorted.at[next_idx, 'action'] = "E_mv"
        
        # 4. Marquer la dernière sortie comme définitive (S_def) uniquement si non classifiée
        last_idx = group.index[-1]
        if (df_sorted.at[last_idx, 'empprod_sortie'] == 'S' and 
            df_sorted.at[last_idx, 'action'] == ""):
            
            # Vérifier si c'est la seule opération à cette date
            last_date = df_sorted.at[last_idx, 'empprod_date_insert']
            date_group = group[group['empprod_date_insert'] == last_date]
            
            # Si c'est la seule opération à cette date, la marquer comme S_def
            if len(date_group) == 1:
                df_sorted.at[last_idx, 'action'] = "S_def"
    
    # Reconvertir la date au format d'origine
    if 'empprod_date_insert' in df_sorted.columns:
        df_sorted['empprod_date_insert'] = df_sorted['empprod_date_insert'].dt.strftime('%d/%m/%Y')
    
    # Réorganiser les colonnes pour placer 'action' juste après 'empprod_sortie'
    if 'empprod_sortie' in df_sorted.columns:
        cols = df_sorted.columns.tolist()
        sortie_idx = cols.index('empprod_sortie')
        action_idx = cols.index('action')
        
        # Retirer 'action' de sa position actuelle
        cols.pop(action_idx)
        
        # L'insérer juste après 'empprod_sortie'
        cols.insert(sortie_idx + 1, 'action')
        
        # Réorganiser le DataFrame
        df_sorted = df_sorted[cols]
    
    # Trier le dataframe par ordre chronologique avant de le retourner
    df_sorted = df_sorted.sort_values(by='empprod_date_insert')
    
    return df_sorted


if __name__ == "__main__":
    main_cli()