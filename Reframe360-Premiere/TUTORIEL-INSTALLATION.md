# Tutoriel d'installation complet — Reframe 360 Pro pour Premiere Pro (Windows)

Ce guide part de zéro et va jusqu'à ton premier plan recadré dans la timeline. Compte **15 minutes**. Chaque étape dit ce que tu dois voir à l'écran, et la partie 10 explique quoi faire si ce n'est pas le cas.

---

## Sommaire

0. [Ce qu'il te faut](#0-ce-quil-te-faut)
1. [Mettre à jour le pilote de la carte graphique](#1-mettre-à-jour-le-pilote-de-la-carte-graphique)
2. [Télécharger le plugin](#2-télécharger-le-plugin)
3. [Extraire le ZIP](#3-extraire-le-zip)
4. [Lancer l'installateur](#4-lancer-linstallateur)
5. [Ouvrir le panneau dans Premiere](#5-ouvrir-le-panneau-dans-premiere)
6. [Vérifier que tout est vert (Diagnostic)](#6-vérifier-que-tout-est-vert-diagnostic)
7. [Préparer tes vidéos 360 (DJI / Insta360)](#7-préparer-tes-vidéos-360-dji--insta360)
8. [Premier recadrage de A à Z](#8-premier-recadrage-de-a-à-z)
9. [Mettre à jour ou désinstaller](#9-mettre-à-jour-ou-désinstaller)
10. [Dépannage](#10-dépannage)
11. [Installation manuelle (sans l'installateur)](#11-installation-manuelle-sans-linstallateur)
12. [FAQ](#12-faq)

---

## 0. Ce qu'il te faut

| | Minimum | Conseillé |
|---|---|---|
| Système | Windows 10 64 bits | Windows 11 64 bits |
| Premiere Pro | **2022** (version 22.0) | 2024 ou 2025, à jour |
| Carte graphique | NVIDIA, AMD ou Intel avec un pilote récent | NVIDIA RTX / AMD RX, 6 Go de mémoire vidéo ou plus pour le 8K |
| Mémoire vive | 16 Go | 32 Go pour le 8K |
| Espace disque | 500 Mo pour le plugin et FFmpeg | SSD avec beaucoup de place libre pour les rendus (voir ci-dessous) |
| Internet | Pendant l'installation (téléchargement de FFmpeg, ~90 Mo) | — |
| Logiciel caméra | **DJI Studio** (pour convertir tes `.OSV` en vidéo 360, voir partie 7) | — |

**Vérifier ta version de Premiere :** menu **Aide › À propos de Premiere Pro**. Il faut 22.0 ou plus (le nom commercial « Premiere Pro 2022 », « 2023 », « 2024 »… va aussi). Sur une version plus ancienne, le panneau n'apparaîtra pas : mets Premiere à jour depuis l'application **Creative Cloud**.

**Espace disque des rendus en ProRes 422 HQ (codec conseillé) :**

| Format de sortie | Par minute de vidéo (30 im/s) |
|---|---|
| 1080p (1920×1080) | ≈ 1,7 Go |
| Vertical 1080×1920 | ≈ 1,7 Go |
| 4K UHD (3840×2160) | ≈ 6,6 Go |

Les fichiers sont lourds, mais c'est ce qui garde la qualité intacte et rend le montage fluide. Si la place manque, choisis le codec **H.265 10 bits** dans l'onglet Export : environ 8 fois plus léger, avec une qualité encore excellente.

---

## 1. Mettre à jour le pilote de la carte graphique

Le recadrage tourne sur la carte graphique. Un pilote ancien est la première cause d'aperçu noir.

- **NVIDIA** : ouvre **GeForce Experience** ou l'**application NVIDIA** › Pilotes › Rechercher les mises à jour. Prends le **Studio Driver** si on te le propose.
- **AMD** : ouvre **AMD Software: Adrenalin Edition** › Rechercher les mises à jour.
- **Intel** (graphique intégré) : installe l'**Intel Driver & Support Assistant** depuis le site d'Intel.

Redémarre le PC si l'installation du pilote le demande.

> 💡 **PC portable avec deux cartes graphiques** (Intel + NVIDIA) : va dans **Paramètres Windows › Système › Affichage › Graphiques**, ajoute **Adobe Premiere Pro** et choisis **Hautes performances**. Premiere et le plugin utiliseront ainsi la carte puissante.

---

## 2. Télécharger le plugin

1. Connecte-toi à GitHub avec ton compte (le dépôt peut être privé).
2. Ouvre la branche du plugin : **https://github.com/loan26112009-sudo/test/tree/claude/peaceful-allen-bjntgv**
3. Clique sur le bouton vert **`<> Code`**, puis **Download ZIP**.

   Lien direct du ZIP : https://github.com/loan26112009-sudo/test/archive/refs/heads/claude/peaceful-allen-bjntgv.zip

Le fichier `test-claude-peaceful-allen-bjntgv.zip` arrive dans ton dossier **Téléchargements**.

---

## 3. Extraire le ZIP

⚠️ **C'est l'étape la plus souvent ratée.** Si tu double-cliques le ZIP puis l'installateur à l'intérieur, Windows lance le script depuis un dossier temporaire et l'installation échoue.

1. Ouvre **Téléchargements**.
2. **Clic droit** sur `test-claude-peaceful-allen-bjntgv.zip` › **Extraire tout…**
3. Choisis un dossier simple, par exemple `C:\Users\<toi>\Documents\Reframe360`, puis **Extraire**.
4. Ouvre le dossier extrait, puis **`Reframe360-Premiere`**. Tu dois voir :

```
Reframe360-Premiere
├── extension\
├── install\
├── docs\
├── tests\
├── Install-Windows.bat      ← l'installateur
├── Uninstall-Windows.bat
├── README.md
└── TUTORIEL-INSTALLATION.md
```

---

## 4. Lancer l'installateur

1. **Ferme Premiere Pro** (enregistre ton projet avant).
2. Double-clique sur **`Install-Windows.bat`**.
3. **Si Windows affiche « Windows a protégé votre ordinateur »** (SmartScreen, normal pour un script téléchargé) : clique sur **Informations complémentaires**, puis **Exécuter quand même**.
4. Une fenêtre noire s'ouvre. **Aucun droit administrateur n'est demandé** : tout s'installe dans ton profil utilisateur.

**Ce que tu dois voir :**

```
  REFRAME 360 PRO - installation pour Adobe Premiere Pro
  ======================================================

  [OK] Premiere Pro detecte : Adobe Premiere Pro 2025

  [1/4] Copie du panneau...
  [OK] Panneau installe dans C:\Users\toi\AppData\Roaming\Adobe\CEP\extensions\com.reframe360.pro
  [2/4] Autorisation des extensions...
  [OK] PlayerDebugMode = 1 (CSXS.9 a CSXS.15)
  [3/4] FFmpeg...
       Telechargement (environ 90 Mo, 1 a 3 minutes) : https://www.gyan.dev/...
  [OK] FFmpeg pret : ffmpeg version 7.x ...
  [4/4] Verification...
  [OK] Tous les fichiers du panneau sont en place

  INSTALLATION REUSSIE

  Ouvre Premiere Pro, puis : Fenetre > Extensions > Reframe 360 Pro
```

5. Appuie sur une touche pour fermer la fenêtre.

**Ce que l'installateur a fait, pour info :**

| Étape | Détail |
|---|---|
| 1 — Copie | Le panneau va dans `%APPDATA%\Adobe\CEP\extensions\com.reframe360.pro` |
| 2 — Autorisation | Premiere n'affiche que les extensions signées par un vendeur. La clé de registre `HKCU\Software\Adobe\CSXS.<version>\PlayerDebugMode = 1` autorise les extensions personnelles comme celle-ci. C'est la méthode standard des panneaux maison, réversible, et elle ne touche que ton compte Windows. |
| 3 — FFmpeg | Le moteur vidéo libre qui lit tes fichiers H.265 8K et écrit le ProRes. Il est téléchargé depuis gyan.dev (ou GitHub en secours) dans le dossier `bin` du panneau. |
| 4 — Vérification | Contrôle que tous les fichiers sont en place. |

Un journal complet est enregistré dans `%TEMP%\reframe360-install.log`. Pour l'ouvrir : touche Windows + R, tape `%TEMP%`, Entrée.

> ⚠️ **Si une ligne jaune `[!]` apparaît pour FFmpeg** (pas d'Internet, antivirus, proxy d'entreprise) : le panneau est quand même installé. Suis la partie 10, ligne « FFmpeg introuvable ».

---

## 5. Ouvrir le panneau dans Premiere

1. Lance **Premiere Pro** et ouvre (ou crée) un projet.
2. Menu **Fenêtre › Extensions › Reframe 360 Pro**.
3. Le panneau s'ouvre en fenêtre flottante, avec une scène de démo (une ville avec « AVANT / DROITE / ARRIÈRE / GAUCHE »). Glisse dans l'image : la vue doit tourner.
4. **Range-le** : attrape l'onglet « Reframe 360 Pro » et dépose-le à côté du Moniteur de programme, ou en bas à côté de la timeline.
5. **Agrandis-le** : le panneau est prévu pour environ 1200×800 pixels. Plus il est grand, plus l'aperçu est confortable.
6. **Enregistre ton espace de travail** pour le retrouver à chaque ouverture : **Fenêtre › Espaces de travail › Enregistrer comme nouvel espace de travail…** › « Montage 360 ».

---

## 6. Vérifier que tout est vert (Diagnostic)

Dans le panneau : onglet **Réglages**, puis la carte **Diagnostic** en bas. Tu dois y lire :

```
Reframe 360 Pro 1.1.0
Panneau : Premiere Pro (CEP) · Chrome/…
Node.js : 1x.x · win32 x64
GPU : ANGLE (NVIDIA GeForce RTX …)        ← ta vraie carte graphique
Texture max : 16384 px                     ← 8192 minimum, 16384 idéal pour le 8K
FFmpeg : C:\Users\…\com.reframe360.pro\bin\ffmpeg.exe
Extension : C:\Users\…\com.reframe360.pro
Premiere Pro : 25.x.x
ffmpeg version 7.x …                      ← sans « encodeurs absents »
```

| Si tu vois… | Alors |
|---|---|
| `GPU : … Microsoft Basic Render Driver` ou `SwiftShader` | Le pilote graphique n'est pas utilisé. Refais l'étape 1, puis redémarre. |
| `Texture max : 8192 px` | Ça marche jusqu'en 8K (7680 px) mais c'est juste. Mets le pilote à jour. |
| `FFmpeg : introuvable` | Voir la partie 10. |
| `encodeurs absents : …` | Ton FFmpeg est incomplet : supprime `bin\ffmpeg.exe` dans le dossier du panneau et relance l'installateur. |

En cas de souci, le bouton **Copier** met tout ce texte dans le presse-papiers pour que tu puisses me l'envoyer.

---

## 7. Préparer tes vidéos 360 (DJI / Insta360)

### Ce qu'il y a sur la carte SD de l'Osmo 360

Dans `DCIM\DJI_001\` (ou un dossier voisin), chaque prise donne **deux fichiers portant le même nom** :

| Fichier | C'est quoi | À utiliser dans Premiere ? |
|---|---|---|
| `DJI_xxxx.OSV` | La vidéo **brute** en pleine qualité, mais avec les **deux objectifs fisheye séparés**, pas encore assemblés en 360. | ❌ Pas directement. Il faut d'abord l'exporter en 360 (ci-dessous). |
| `DJI_xxxx.LRF` | Une **copie basse résolution** que la caméra enregistre pour les aperçus rapides (application DJI, DJI Studio). | ❌ Jamais pour le rendu : la qualité serait très mauvaise. |

Le plugin recadre des vidéos **360° équirectangulaires** : une image 2:1 qui ressemble à une carte du monde, par exemple 7680×3840. Pour transformer tes `.OSV` en vidéo de ce type, il faut **DJI Studio**. L'assemblage (« stitching ») des deux objectifs utilise la calibration propre à ta caméra, que seul DJI exploite correctement. C'est aussi là que tu actives la stabilisation, qui fait toute la qualité du rendu final.

> Si tu sélectionnes quand même un `.OSV` ou un `.LRF` dans le panneau, il te le signale et refuse de lancer le rendu, pour éviter de gâcher du temps et de la qualité.

### Étapes avec DJI Studio (Osmo 360)
1. **Copie tout le dossier** de la carte SD sur ton disque (garde `.OSV` et `.LRF` ensemble : DJI Studio se sert des `.LRF` pour afficher plus vite).
2. Installe **DJI Studio** (gratuit, site de DJI › page de l'Osmo 360 › Téléchargements). Il existe aussi l'application mobile **DJI Mimo** si tu préfères exporter depuis ton téléphone.
3. Ouvre DJI Studio et importe tes fichiers **`.OSV`**.
4. Sélectionne le clip, puis **Exporter** en **vidéo 360 / panoramique**. Ne choisis **pas** le recadrage : c'est le plugin qui s'en charge.
5. Réglages conseillés :
   - **résolution maximale** (8K si disponible) ;
   - **débit maximal** ;
   - **stabilisation activée** et **horizon verrouillé** (horizon lock) ;
   - codec **H.265** (ou ProRes s'il est proposé).
6. Tu obtiens un fichier **`.MP4`** 360. **C'est lui que tu importes dans Premiere.**
7. Une fois tes exports vérifiés, tu peux archiver ou supprimer les `.LRF` pour gagner de la place. Garde les `.OSV` : ce sont tes originaux.

### Insta360 (X3, X4, X5…) → Insta360 Studio
Même principe avec les fichiers `.insv` : importe-les dans **Insta360 Studio**, laisse la vue en **360**, puis exporte en **Vidéo 360°** avec **résolution maximale**, **H.265**, **FlowState** et **verrouillage d'horizon**.

> Les noms exacts des options changent selon les versions de ces logiciels. Retiens les principes : **vidéo 360 équirectangulaire, résolution max, stabilisation + horizon, débit max.**

---

## 8. Premier recadrage de A à Z

Le test complet prend environ 5 minutes.

### a) Préparer la séquence
1. Importe ta vidéo 360 exportée dans Premiere (glisser-déposer dans le panneau Projet).
2. Crée une **séquence au format final**, sinon Premiere crée une séquence 2:1 géante :
   **Fichier › Nouveau › Séquence…** › onglet **Paramètres** › Mode d'édition **Personnalisé** › taille **3840 × 2160** (YouTube 4K) ou **1080 × 1920** (Shorts/Reels) › même cadence que tes rushs.
   Si Premiere propose de « modifier les paramètres de la séquence » quand tu poses le clip, réponds **Conserver les paramètres existants**.
3. Pose le clip 360 sur la piste **V1**.

### b) Charger le clip dans le panneau
4. **Clique sur le clip dans la timeline** pour le sélectionner (pas dans le panneau Projet).
5. Dans Reframe 360 Pro : bouton bleu **Clip sélectionné**.
6. En haut du panneau, tu vois le nom du fichier, sa résolution, `HEVC 10 bits`… L'aperçu affiche ta vidéo, et la barre verte sous la règle de la timeline du panneau montre le cache d'aperçu qui se prépare.

### c) Cadrer et animer
7. **Glisse** dans l'image pour viser ton sujet, et utilise la **molette** pour zoomer.
8. Appuie sur **3** (objectif *Large*), puis **K** : un losange jaune (une clé) apparaît sur la timeline du panneau.
9. Clique 2 secondes plus loin sur la timeline du panneau, appuie sur **7** (*Tiny Planet*), puis **K**.
10. Appuie sur **Espace** : l'aperçu joue la transition Large → Tiny Planet. Espace à nouveau pour arrêter.

> La tête de lecture du panneau et celle de Premiere sont **synchronisées** dans les deux sens (interrupteur « Sync » en haut à droite).

### d) Rendre
11. Onglet **Export** :
    - Format : **Comme la séquence**
    - Codec : **Apple ProRes 422 HQ** (recommandé)
    - Interpolation : **Lanczos-3**, super-échantillonnage : **Auto** (réglages par défaut)
    - Après le rendu : **Placer au-dessus du clip**
12. Clique **RENDU**. La barre montre la progression, la vitesse (images/s) et le temps restant.
13. Une fois le rendu fini :
    - le plan recadré est posé sur **la première piste vidéo libre au-dessus de ton clip**. Une piste est créée si besoin, et rien de ce qui se trouve déjà sur V2/V3 n'est écrasé ;
    - le clip 360 d'origine est **désactivé** (il reste dans la timeline, grisé) ;
    - le fichier est dans le chutier **« Reframe 360 »** et sur le disque, dans un dossier **`Reframe360`** à côté de ta vidéo source.

### e) Modifier un recadrage déjà rendu
14. Sélectionne le **clip 360 d'origine** (le clip grisé) › **Clip sélectionné**. Tes clés reviennent automatiquement.
15. Corrige, puis **RENDU** : un nouveau plan est posé. Supprime l'ancien plan rendu de la timeline.

### Raccourcis à retenir
| Touche | Action |
|---|---|
| Espace | Lecture / pause |
| ← / → | Image précédente / suivante |
| Maj + ← / → | Clé précédente / suivante |
| K | Poser / mettre à jour une clé |
| Suppr | Supprimer la clé sous la tête de lecture |
| 1 à 9 | Télé, Normal, Large, Ultra large, Hyper large, Fisheye, Tiny Planet, Rabbit Hole, Crystal Ball |
| R | Recentrer la caméra |
| Molette / Ctrl + molette | Zoom / courbure de l'objectif |
| Maj + glisser | Roulis (pencher l'image) |
| Double-clic | Remettre l'horizon à niveau |
| G / H | Grille des tiers / ligne d'horizon |

> Les raccourcis marchent quand le panneau a le focus. Clique une fois dans l'image du panneau avant de les utiliser.

---

## 9. Mettre à jour ou désinstaller

**Mettre à jour** (nouvelle version du plugin) :
1. Télécharge et extrais le nouveau ZIP (étapes 2 et 3).
2. Ferme Premiere et relance **`Install-Windows.bat`**.
   FFmpeg n'est pas retéléchargé, et tes cadrages et clés sont conservés.

**Désinstaller** :
1. Ferme Premiere et double-clique **`Uninstall-Windows.bat`**.
2. Il supprime le panneau et le cache d'aperçu, et te demande si tu veux aussi effacer tes cadrages enregistrés.
   Tes vidéos déjà rendues (dossiers `Reframe360`) ne sont jamais touchées.

---

## 10. Dépannage

### Installation

| Problème | Solution |
|---|---|
| **« Windows a protégé votre ordinateur »** | Informations complémentaires › **Exécuter quand même**. |
| **La fenêtre noire s'ouvre et se ferme aussitôt** | Tu as lancé le `.bat` depuis l'intérieur du ZIP : extrais d'abord (étape 3). |
| **« [X] Fichiers introuvables. Extrais d'abord le ZIP »** | Même cause, même solution. |
| **L'antivirus bloque ou supprime `ffmpeg.exe`** | Faux positif fréquent. Ajoute une exclusion pour le dossier `%APPDATA%\Adobe\CEP\extensions\com.reframe360.pro`, puis relance l'installateur. |
| **FFmpeg pas téléchargé** (pas d'Internet, proxy) | 1. Télécharge https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip sur n'importe quel PC. 2. Extrais-le. 3. Copie `bin\ffmpeg.exe` et `bin\ffprobe.exe` dans `%APPDATA%\Adobe\CEP\extensions\com.reframe360.pro\bin\` (colle ce chemin dans la barre d'adresse de l'Explorateur). |

### Le panneau

| Problème | Solution |
|---|---|
| **« Reframe 360 Pro » n'est pas dans Fenêtre › Extensions** | 1. Premiere était ouvert pendant l'installation : ferme-le complètement et relance-le. 2. Vérifie ta version (Aide › À propos) : il faut 2022 ou plus. 3. Vérifie que ce fichier existe : `%APPDATA%\Adobe\CEP\extensions\com.reframe360.pro\CSXS\manifest.xml`. 4. Refais l'autorisation à la main (partie 11, étape 2). |
| **Le menu Extensions est grisé** | Ouvre d'abord un projet, puis réessaie. |
| **Panneau tout blanc ou vide** | Ferme le panneau et rouvre-le. Si ça persiste : mets à jour le pilote graphique et redémarre Premiere. |
| **« WebGL2 indisponible » ou aperçu noir** | Pilote graphique (étape 1). Sur un portable, force Premiere en « Hautes performances » (encadré de l'étape 1). |
| **« FFmpeg introuvable »** | Réglages › FFmpeg › **Choisir…** › sélectionne `ffmpeg.exe`, ou relance l'installateur. |
| **« Erreur ExtendScript »** | Redémarre Premiere. Le script qui relie le panneau à la timeline n'a pas été chargé. |
| **Espace lance la lecture de Premiere au lieu du panneau** | Clique d'abord dans l'image du panneau pour lui donner le focus. |

### Charger un clip

| Problème | Solution |
|---|---|
| **« Sélectionne un clip 360 dans la timeline »** | Clique sur le clip **dans la timeline** (pas dans le panneau Projet), puis **Clip sélectionné**. |
| **« Aucune séquence active »** | Ouvre la séquence (double-clic dans le panneau Projet) puis clique dans la timeline. |
| **« Ce clip n'a pas de fichier média »** | Le clip sélectionné est une séquence imbriquée, un titre ou un calque d'effets : sélectionne le vrai fichier vidéo 360. |
| **« fichier brut .OSV »** | Normal : exporte-le en vidéo 360 depuis DJI Studio, puis charge l'export `.MP4` (partie 7). |
| **« fichier .LRF = aperçu basse résolution »** | Tu as pris le fichier d'aperçu. Utilise l'export 360 pleine résolution de DJI Studio (partie 7). |
| **« ⚠ pas un équirectangulaire 2:1 »** | Fichier déjà recadré ou mauvais type d'export : réexporte en **vidéo 360** depuis DJI Studio / Insta360 Studio (partie 7). |
| **« ⚠ vitesse du clip … % »** | Le rendu se fait à vitesse normale. Applique ralenti/accéléré sur le plan recadré, après le rendu. |
| **« Impossible de lire ce fichier »** | Fichier encore en cours de copie, ou sur un disque débranché. Attends la fin de la copie. |

### Rendu

| Problème | Solution |
|---|---|
| **« Échec du rendu : Décodage… »** | Réglages › décoche **Décodage GPU** et relance le rendu. |
| **« Dossier de sortie inaccessible »** | La vidéo source est sur une carte SD verrouillée ou un disque en lecture seule. Export › Dossier › **Changer** et choisis un dossier sur ton disque. |
| **« ⚠ cadrage non posé en clé ignoré »** | Tu as modifié le cadrage sans appuyer sur **K** : pose la clé et relance. |
| **Le rendu est lent** | C'est normal en 8K : le calcul est fait en haute précision. Pour accélérer : Interpolation **Bicubique**, flou de mouvement désactivé, ferme les autres logiciels. Teste d'abord sur un clip court. |
| **Le disque est plein** | Choisis le codec **H.265 10 bits** (8× plus léger), ou un dossier de sortie sur un autre disque. |
| **Le plan est allé dans le chutier mais pas dans la timeline** | Le message en bas en donne la raison. Souvent, tu as changé de séquence pendant le rendu : glisse simplement le plan du chutier « Reframe 360 » sur la timeline. |
| **Premiere demande de « relier le média »** | Tu as déplacé ou renommé le dossier `Reframe360`. Remets-le en place ou relie-le. |

### Me demander de l'aide

Envoie-moi :
1. Le texte de **Réglages › Diagnostic › Copier**.
2. Le message en rouge en bas du panneau.
3. En cas de problème d'installation : le fichier `%TEMP%\reframe360-install.log`.

---

## 11. Installation manuelle (sans l'installateur)

Si le `.bat` ne peut pas tourner (PC d'entreprise verrouillé, par exemple) :

1. **Copier le panneau.** Copie le dossier **`extension`** vers :
   `%APPDATA%\Adobe\CEP\extensions\`
   puis renomme la copie en **`com.reframe360.pro`**.
   Tu dois obtenir : `…\extensions\com.reframe360.pro\CSXS\manifest.xml`.

2. **Autoriser l'extension.** Ouvre l'**Invite de commandes** (touche Windows, tape `cmd`, Entrée) et colle :
   ```
   reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add HKCU\Software\Adobe\CSXS.13 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
   Chaque ligne doit répondre « L'opération a réussi ».

3. **FFmpeg.** Télécharge https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip, extrais-le, puis copie `ffmpeg.exe` et `ffprobe.exe` (dans son dossier `bin`) vers :
   `%APPDATA%\Adobe\CEP\extensions\com.reframe360.pro\bin\`

4. Relance Premiere › **Fenêtre › Extensions › Reframe 360 Pro**.

---

## 12. FAQ

**Est-ce que ça baisse la qualité ?**
Non. Le traitement reste en 10 bits du début à la fin, avec un filtre Lanczos-3 et un anti-aliasing adaptatif. Le recadrage a été vérifié image par image contre un calcul de référence : il n'ajoute aucune perte au-delà du codec choisi. En ProRes 422 HQ, cette perte est invisible.

**Pourquoi un rendu, et pas un effet en direct comme le plugin DJI ?**
Le plan recadré est calculé une fois, en qualité maximale, puis tu montes un fichier ProRes léger à lire. Résultat : ta timeline reste fluide même avec des sources 8K, et l'export final de Premiere est plus rapide.

**Où sont enregistrées mes clés ?**
Dans `%APPDATA%\Reframe360Pro\sessions`, une par clip. Elles reviennent dès que tu recharges le clip, même après avoir fermé Premiere.

**Où est le cache d'aperçu ? Il prend de la place ?**
Dans `%TEMP%\Reframe360Pro`. Il est nettoyé tout seul après 7 jours, et tu peux le vider avec Réglages › **Vider le cache**.

**Pourquoi le plugin ne lit pas directement mes `.OSV` comme le plugin DJI sur Mac ?**
Le fichier `.OSV` contient les deux objectifs séparés. Pour les assembler sans couture visible, il faut la calibration exacte de ta caméra, que DJI n'a pas rendue publique. Un assemblage « approximatif » donnerait une ligne de raccord visible, l'inverse du but recherché. DJI Studio fait cet assemblage parfaitement, avec la stabilisation, en une seule étape.

**Ça marche avec la GoPro MAX, la Ricoh Theta, la Qoocam… ?**
Oui, avec n'importe quelle vidéo 360 équirectangulaire 2:1 exportée depuis le logiciel de la caméra.

**Et sur Mac ?**
Oui : `install/install-mac.sh` puis `brew install ffmpeg`.

**Puis-je inclure le son de la caméra ?**
Oui : Export › **Inclure l'audio**. Il est désactivé par défaut, car le son de ton clip 360 est déjà dans la timeline. Activé, il serait placé sur une piste audio et pourrait recouvrir un autre son.
