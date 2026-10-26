# Reframe 360 Pro — recadrage 360° pour Premiere Pro (Windows & Mac)

Panneau Premiere Pro qui recadre tes vidéos 360° (DJI Osmo 360, Insta360 X3/X4/X5, GoPro MAX, Ricoh Theta…) en plans classiques 16:9, 9:16, 1:1… avec images clés, tous les objectifs des plugins DJI Reframe et Insta360 Reframe, plus des niveaux d'ultra grand-angle en plus.

Il marche sur **Windows**, alors que le plugin DJI n'existe que sur Mac.

---

## Ce qu'il fait

| | Reframe 360 Pro |
|---|---|
| **Objectifs** | Télé · Normal · Large · **Ultra large** · **Hyper large** · Fisheye · **Tiny Planet** · **Rabbit Hole** · **Crystal Ball**. Ce sont des réglages de départ : FOV (10–360°) et courbure (0–3) se règlent en continu et s'animent. |
| **Images clés** | Lacet / tangage / roulis / FOV / courbure. Transitions *Fluide* (style Insta360, sans dépassement), *Ease in/out*, *Linéaire*, *Cut*. Le zoom est interpolé de façon perceptuelle et le lacet passe toujours par le chemin le plus court. |
| **Formats** | Comme la séquence, 4K UHD, Full HD, DCI 4K, **vertical 9:16** (Shorts, Reels, TikTok), carré 1:1, 4:5, 2.39:1 cinéma, 21:9 ou taille personnalisée. |
| **Qualité** | Pipeline **10 bits** de bout en bout, filtre **Lanczos-3**, **super-échantillonnage adaptatif** jusqu'à 4×4 (aucun aliasing ni moiré en grand-angle ou en Tiny Planet), raccord sans couture à l'arrière et aux pôles, couleurs (Rec.709 / Rec.2020 / HLG / D-Log M) conservées. |
| **Codecs** | ProRes 422 HQ (recommandé, fluide au montage), ProRes 4444, DNxHR HQX, H.265 10 bits, H.264. |
| **Bonus** | Flou de mouvement sur les mouvements de caméra (obturateur 90–360°), netteté optionnelle, correction d'horizon pour tout le clip, mini-carte 360 cliquable, ligne d'horizon, grille des tiers. |
| **Premiere** | Charge le clip sélectionné et sa plage in/out, synchronise la tête de lecture dans les deux sens, puis **place automatiquement le plan recadré au-dessus du clip d'origine** (qui est désactivé). Les cadrages sont sauvegardés par clip. |

### Ce que veut dire « sans perte »
Le moteur a été testé image par image contre une implémentation de référence indépendante :
- reprojection GPU identique à la référence à **±1 code sur 1023** (10 bits) ;
- chaîne complète décodage → recadrage → encodage ProRes égale au **plafond du codec** : le recadrage n'ajoute aucune perte au-delà du codec choisi ;
- alignement des images exact (aucun décalage d'une image), audio synchronisé.

---

## Installation (Windows)

1. Télécharge ce dossier (`Code` → `Download ZIP` sur GitHub) et dézippe-le.
2. **Ferme Premiere Pro.**
3. Double-clique sur **`Install-Windows.bat`**. Le script :
   - copie le panneau dans `%APPDATA%\Adobe\CEP\extensions` (pas besoin d'être administrateur) ;
   - active les extensions non signées (`PlayerDebugMode`) ;
   - télécharge FFmpeg (décodage H.265 10 bits / 8K et encodage ProRes).
4. Ouvre Premiere Pro → **Fenêtre › Extensions › Reframe 360 Pro**.

Configuration requise : Premiere Pro 2020 (14.0) ou plus récent, une carte graphique compatible WebGL 2 (toute carte NVIDIA, AMD ou Intel récente, pilote à jour).

Sur Mac : `install/install-mac.sh` (et `brew install ffmpeg`).

---

## Comment l'utiliser

1. **Exporte ta vidéo en 360° équirectangulaire** depuis DJI Studio (Osmo 360) ou Insta360 Studio, avec la stabilisation et le verrouillage d'horizon activés. C'est là que se fait le raccord des deux objectifs. Les fichiers bruts `.OSV` / `.INSV` à double fisheye ne sont pas recadrables tels quels.
2. Mets le fichier 360 dans ta séquence Premiere, sélectionne le clip et clique **« Clip sélectionné »**.
3. Cadre :
   - **glisser** dans l'image pour orienter, **molette** pour zoomer, **Maj+glisser** pour le roulis, **Alt+molette** pour la courbure ;
   - touches **1 à 9** pour les objectifs, clic sur la **mini-carte 360** pour viser un point.
4. **K** pose une image clé. Déplace la tête de lecture, recadre, puis **K** à nouveau. Les clés se déplacent à la souris sur la timeline du panneau, et le menu déroulant choisit la transition.
5. Onglet **Export** : choisis le format (par défaut celui de la séquence) puis clique **RENDU**. Le plan recadré est placé au-dessus de ton clip 360, à la même position dans la séquence.

### Raccourcis
`Espace` lecture · `←/→` image · `Maj+←/→` clé précédente/suivante · `K` clé · `Suppr` supprimer la clé · `1–9` objectifs · `R` réinitialiser · `I/O` entrée/sortie (fichier ouvert seul) · `G` grille · `H` horizon · double-clic : remettre l'horizon à niveau.

### Conseils qualité
- Garde **Lanczos-3 + super-échantillonnage Auto** (réglages par défaut). En 4K depuis une source 8K, c'est ce qui donne l'image la plus nette sans scintillement.
- **ProRes 422 HQ** est le meilleur choix pour monter ensuite (fichiers lourds, mais fluides et 10 bits). Choisis **H.265 10 bits** si l'espace disque compte.
- Laisse la netteté à 0, sauf si la source est vraiment molle.
- Le flou de mouvement à 180° rend les mouvements de caméra rapides plus cinéma.

---

## Dépannage
- **Le panneau n'apparaît pas** : relance `Install-Windows.bat` avec Premiere fermé (il doit écrire `PlayerDebugMode`).
- **« FFmpeg introuvable »** : onglet Réglages → *Choisir…* → sélectionne `ffmpeg.exe`.
- **Erreur de décodage** : décoche *Décodage GPU* dans Réglages.
- **Aperçu noir** : mets à jour le pilote de la carte graphique.
- Débogage : avec le panneau ouvert, va sur `http://localhost:8099` dans Chrome.

---

## Pour les développeurs

```
extension/
  CSXS/manifest.xml        panneau CEP (Premiere 14+)
  host/premiere.jsx        ExtendScript : sélection, tête de lecture, import et placement
  js/core/math.js          projection (perspective généralisée), objectifs, formats
  js/core/keyframes.js     images clés (Hermite monotone, ease, linéaire, cut)
  js/gl/renderer.js        moteur WebGL2 : aperçu + export 10 bits (Lanczos/bicubique, SSAA, flou de mouvement, tuiles anti-TDR)
  js/bridge/ffmpeg.js      décodage x2rgb10le / encodage ProRes, DNxHR, HEVC, H.264, cache d'aperçu
  js/app/exporter.js       boucle de rendu décodeur → GPU → encodeur
  js/app/main.js           interface
tests/                     tests (Node + Playwright + FFmpeg + numpy)
```

Modèle d'objectif : la caméra virtuelle est placée en `(0,0,-d)` par rapport à la sphère unité. `d = 0` donne une projection rectilinéaire, `d = 1` une projection stéréographique (Tiny Planet), et `d > 1` place la caméra hors de la sphère (Crystal Ball). Toutes les valeurs intermédiaires s'animent.

Tests : `npm test` (il faut Node 18+, FFmpeg, Python 3 + numpy et Playwright/Chromium).
