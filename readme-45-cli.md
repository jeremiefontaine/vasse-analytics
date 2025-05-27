# Guide du script `45-cli.py`

Ce document présente le rôle de chaque fonction définie dans `45-cli.py`. Le script automatise la récupération des données du site **vassestockage.fr**, la manipulation des historiques et la génération de fichiers exploitables. Les descriptions ci‑dessous reprennent les paramètres et le résultat de chaque fonction.

## Fonctions utilitaires et connexion

### `update_clients_json(client_name)`
Met à jour `data/clients.json` en ajoutant le nom de client fourni (les espaces sont remplacés par des `_`). Le fichier est créé s'il n'existe pas déjà.

### `login_and_get_session_data()`
Ouvre une session Selenium en mode *headless* sur le site, renseigne les identifiants contenus dans les variables d'environnement `VA_SITE_USERNAME` et `VA_SITE_PASSWORD`, puis renvoie un dictionnaire `{"driver": webdriver}` si la connexion réussit.

### `retrieve_clients_from_select(driver)`
Utilise le driver Selenium connecté pour aller sur la page d'inventaire, lire la liste `<select>` des clients et retourner une liste de dictionnaires `{"value": id, "name": nom}`.

### `get_wb_token(driver)`
Extrait depuis la page courante le token `wb-token` stocké dans une balise `<meta>` et le renvoie. Retourne `None` si la balise est introuvable.

### `get_session_cookies(driver)`
Convertit la liste de cookies Selenium en dictionnaire `{nom: valeur}` afin de pouvoir effectuer des requêtes HTTP avec la même session.

### `sanitize_filename(name)`
Remplace les caractères problématiques dans `name` (espaces, points, parenthèses, `/`, `\` ...) par des underscores pour créer un nom de fichier sûr.

### `build_live_table(client_name, tasks)`
Construit un tableau Rich affichant l'état d'avancement des différentes tâches pour un client. Chaque élément de `tasks` doit contenir `task_name`, `progress` et un indicateur `ok`.

## Récupération des données

### `retrieve_initial_data_with_client(session_data, cid)`
Envoie une requête POST au service `fnc_selectInventaire` pour obtenir l'inventaire du client `cid`. Utilise le token et les cookies extraits par Selenium. Retourne un `DataFrame` pandas.

### `process_inventory_data(df_inv)`
Nettoie le DataFrame d'inventaire : normalisation de la colonne `prod_designation` (remplacement des espaces ou `/` par `_` puis passage par `sanitize_filename`).

### `download_images_for_subset(df_sub, images_dir, tasks, index_task, live, client_name)`
Télécharge de façon asynchrone les images JPEG référencées dans `df_sub` vers `images_dir`. La progression est mise à jour en direct grâce à l'objet `Live` de Rich.

### `convert_one_image(args)` et `convert_images_to_webp_diff(df_sub, images_dir, webp_dir, tasks, index_task, live, client_name)`
La première fonction convertit une image JPEG en WebP. La seconde parcourt toutes les images présentes dans `images_dir` et les convertit avec un pool de processus vers `webp_dir` tout en indiquant l'avancement.

### `retrieve_history_for_subset(session_data, selected_cli_id, df_sub, tasks, index_task, live, client_name, outdir)`
Récupère de manière asynchrone l'historique et le volume de stock pour chaque produit listé dans `df_sub`. Les données sont fusionnées et enregistrées dans `stock_volume.json`. La fonction renvoie un `DataFrame` contenant l'historique pour ces produits.

### `clean_history(df_history)`
Applique plusieurs nettoyages sur un historique : conversion de date, suppression des lignes "NON DEFINI" et normalisation du champ `sit_nom` pour certains enregistrements.

### `update_merged_history_for_client(client, history_df)`
Met à jour (ou crée) le fichier `data/merged_history.csv` en remplaçant les anciennes données du client par celles fournies. Les colonnes et types sont harmonisés pour l'ensemble du CSV.

### `merge_all_history_files(client_list)`
Lit chaque `history.csv` présent dans `data/<client>` pour fusionner toutes les historiques en un seul fichier `merged_history.csv`. Un tableau Rich indique la progression de la fusion.

## Analyses et indicateurs

### `list_zero_sortie(df_history, output_dir)`
Crée `zero_sortie.csv` qui liste les produits n'ayant jamais enregistré de sortie (`empprod_sortie == 'E'`). Retourne également la liste de ces produits.

### `calculate_taux_utilite(df_history, cli_id)`
Calcule, pour chaque produit, le taux d'utilité défini comme `nb_S / nb_E`. Un filtrage particulier est appliqué si le client correspond à l'identifiant `10` (site de Colombes).

### `calculate_obsolescence(df_history)`
Estime pour chaque produit un nombre de mois d'obsolescence en fonction des dernières dates d'entrée ou de sortie observées.

### `prepare_data_for_web(df_obso, df_util, df_inv)`
Fusionne l'obsolescence, le taux d'utilité et l'inventaire. Le résultat inclut une colonne `image_url` pointant vers l'image WebP correspondante.

### `analyze_sorties(df_history, output_dir)`
Analyse la fréquence des sorties pour générer deux fichiers : `sorties_par_produit_trie.csv` (classement) et `cooccurrence.json` (matrice de cooccurrences), ainsi qu'une heatmap PNG.

## Exécution de la chaîne complète

### `run_tasks_full(session_data, cid, client_name, outdir)`
Orchestre l'ensemble du workflow pour un client donné : récupération de l'inventaire, téléchargement et conversion des images, historique détaillé, calculs d'utilité et d'obsolescence, cooccurrences et sauvegardes des différents fichiers. Chaque étape est suivie par Rich.

### `main_cli()`
Point d'entrée du script. Gère les arguments de ligne de commande (`--scrap-all` ou `--client <Nom>`) puis lance les traitements nécessaires. En absence d'arguments, un mode interactif permet de sélectionner un ou plusieurs clients à traiter.

### `add_action_column(df)`
Ajoute une colonne `action` dans un historique pour identifier :
- `C` : création de l'article,
- `E_mv` : entrée liée à un mouvement temporaire,
- `S_mv` : sortie de mouvement temporaire,
- `S_def` : sortie définitive.

Le tri par `art_id` puis par date assure une classification cohérente.

---

Chaque fonction contribue ainsi à la constitution et à l'analyse des données issues de vassestockage.fr. Le script complet permet d'obtenir des exports CSV/JSON et des représentations graphiques exploitables pour le suivi logistique des clients.

## Détail du flux de scraping et de traitement

1. **Connexion initiale**
   - `login_and_get_session_data` lance un navigateur headless, se connecte et renvoie `driver`.
   - `get_wb_token` et `get_session_cookies` utilisent ce `driver` pour récupérer le `wb-token` et les cookies nécessaires aux appels HTTP.

2. **Sélection du client et récupération de l'inventaire**
   - `retrieve_clients_from_select` lit la liste des clients pour permettre le choix dans `main_cli`.
   - Après sélection, `retrieve_initial_data_with_client` interroge l'API d'inventaire avec le token et les cookies.
     Le résultat est un `DataFrame` `df_inv`.
   - `process_inventory_data` nettoie ce DataFrame qui sert ensuite de référence aux autres étapes.

3. **Téléchargement et préparation des images**
   - `download_images_for_subset` parcourt `df_inv` ou un sous-ensemble pour télécharger les photos des produits.
     La progression est suivie via la liste `tasks` et `Live` de Rich.
   - `convert_images_to_webp_diff` convertit ensuite ces JPEG en WebP pour un usage web plus léger.

4. **Récupération et fusion de l'historique**
   - `retrieve_history_for_subset` s'appuie sur `session_data` et `df_inv` pour interroger les endpoints
     `fnc_selectHistoArticles` puis `fnc_selectStockProduit` pour chaque article.
     Les réponses sont fusionnées en un `DataFrame` complet.
   - `clean_history` homogénéise ce DataFrame avant sa sauvegarde.
   - `update_merged_history_for_client` écrit ces informations dans `data/merged_history.csv` et
     `merge_all_history_files` combine l'ensemble des clients si nécessaire.

5. **Analyses et exports**
   - `list_zero_sortie`, `calculate_taux_utilite` et `calculate_obsolescence` utilisent l'historique
     pour produire divers indicateurs.
   - `prepare_data_for_web` rassemble inventaire et indicateurs dans un unique DataFrame prêt pour un export web.
   - `analyze_sorties` crée enfin la heatmap et les fichiers de classement par produit.

6. **Orchestration générale**
   - `run_tasks_full` enchaîne toutes ces opérations pour un client en mettant à jour `tasks`.
   - `main_cli` gère la sélection du client et déclenche `run_tasks_full` ou la fusion globale.

Ce cheminement illustre la façon dont les mêmes structures (token, cookies, `df_inv`, `df_history`)
se transmettent d'une fonction à l'autre jusqu'aux exports finaux.
