# Vasse Transfert Analytics

Application d’analyse et de gestion d’inventaire mobilier multisite, orientée analytique, 100% frontend.  
**Développée pour la rapidité, la visualisation et l’ergonomie.**

---

## 🚀 Stack technique

- **Frontend pur :**
  - HTML5 + CSS3 (custom, dark mode natif)
  - JavaScript ES6+
  - D3.js v7 (visualisation interactive)
  - SheetJS (xlsx) pour l’export tableur
  - FontAwesome (icônes vectorielles)
- **Aucune dépendance backend** : tout est en mémoire côté client.
- **Design responsive** : adaptation tablette/mobile

---

## 🧩 Architecture et Fonctionnement

### **1. Layout global**

- **Deux sidebars fixes :**
  - Gauche = Filtres (tri, dimensions, site, emplacement, recherche…)
  - Droite = Résumé, stats sélection et panier en cours
- **Navigation par onglets** (pills animées) :
  - Sélecteur de client dynamique
  - Onglets : Les Essentiels / Utilité & Obsolescence / Corrélations des sorties / DeepSearch
- **Section centrale** :
  - Grille de cartes interactives (sélection, badges, quantités…)
  - Contrôles sticky (recherche, reset filtres, sélection globale, loupe)

### **2. Principales fonctionnalités**

- **Gestion de l’inventaire mobilier** :
  - Filtres multi-critères ultra-rapides
  - Sélection intelligente : checkbox “tout sélectionner”, gestion du panier dynamique
  - Résumé statistique instantané (nombre, volume, diversité des sites/emplacements)
- **Visualisation analytique** :
  - Scatter plot Utilité / Obsolescence (D3.js)
  - Corrélations visuelles entre sorties (badges, modale détail)
- **DeepSearch** :
  - Tableau triable, filtrable, exportable XLSX
  - Sélection/dé-sélection colonnes à la volée
  - Pagination intelligente, filtrage par champ, recherche booléenne avancée
- **Gestion du panier** :
  - Ajout/retrait, suppression individuelle/globale, validation finale (modale login)
  - Panier affiché en résumé dans sidebar et en détail (modale paginée/tableau)
- **Feedback utilisateur permanent** :
  - Overlays de chargement/erreur, loaders animés
  - Notifications, effets de transitions, focus visuel fort

### **3. Organisation UI/UX**

- **Cartes mobilier** :
  - Image, désignation, dimensions, pastilles de quantité, badges (utilisé, popularité, obsolescence, corrélations…)
  - Sélection multiple, animation d’apparition/disparition
- **Filtres latéraux** :
  - Recherche full-text, filtres numériques pour dimensions, tri multi-critères
  - Listes de sites/emplacements dynamiques avec recherche et autocomplétion
- **Sidebars** :
  - Résumé complet : sélection, stats, panier, suppression, validation
- **Onglets analytiques** :
  - Switch pill animé, focus, accessibilité soignée
- **Modales** :
  - Panier détaillé (tableau paginé), corrélations (zoom), login validation
  - Fermeture par clic overlay ou croix
- **Tableaux dynamiques** :
  - DeepSearch, export direct XLSX, sélection colonnes, filtres multi-champs, tri, pagination

### **4. Design system & CSS**

- **Palette sombre douce** (bleu nuit, gris, vert lime en accent)
- **Boutons ronds/arrondis** partout (look moderne, tactile-friendly)
- **Grille CSS flexible** (flex/grid responsive)
- **Animations d’apparition et feedback visuel**
- **Cartes et sidebars** avec ombre portée, arrondis, focus fort sur la clarté
- **Accessibilité** : contraste, focus, taille d’input, navigation clavier

---

## 🎯 Points d’usage clés

- **Ultra-rapide** : toutes les interactions (filtres, tris, recherches) sont immédiates.
- **Expérience “dashboard”** : visualisation analytique avancée pour un usage terrain ou bureau.
- **Autonomie** : aucune connexion serveur requise.
- **Visualisation & export** : tout ce qui s’affiche peut être exporté, filtré, trié à la volée.
- **Prêt à intégrer d’autres datasets** : structure générique pour l’inventaire mobilier multi-site.

---

## 🛠️ Pour démarrer

1. **Placer les données** (JSON, CSV) au format attendu dans le navigateur (fonction de chargement à implémenter/adapter si besoin).
2. **Ouvrir `index.html`** dans le navigateur (Chrome/Firefox/Safari).
3. **Naviguer, filtrer, analyser !**

---

## 💡 Personnalisation

- **Ajout de nouveaux filtres/critères** : voir sidebar gauche, champs dynamiques
- **Customisation des visualisations** : adapter D3.js dans `app.js`
- **Thème CSS** : modifier les variables dans `styles.css`
- **Internationalisation** : labels/placeholder 100% en français, à adapter facilement

---

## 🔒 Limitations et sécurité

- **Pas de stockage permanent** (localStorage possible à ajouter)
- **Toute la logique en mémoire** : éviter les inventaires >10000 entrées pour garantir la fluidité.
- **Pas de vrai login — la “validation” est purement visuelle.**

---

## ✨ Inspirations et points différenciants

- **Mix entre outil d’inventaire métier et dashboard analytique moderne**
- **Ergonomie pensée pour le “zéro friction”**
- **Moteur DeepSearch avancé type “spreadsheet surboosté”**

---

## 📁 Structure des fichiers

- `index.html` : structure, disposition, points d’injection JS
- `styles.css` : thème, layout, responsive, effets visuels, design system
- `app.js` : logique métier, gestion états, interactions, visualisations D3.js, exports

---

**Développé avec 💚 pour l’efficacité, la clarté, et la vitesse d’analyse.**

---

