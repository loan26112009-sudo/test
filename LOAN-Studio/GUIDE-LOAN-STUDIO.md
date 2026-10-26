# Guide LOAN Studio — ton cockpit de montage dans Premiere Pro

LOAN Studio est construit autour de **ta** méthode, telle qu'elle est écrite dans ton Notion :
- le protocole vidéo longue (sujet S−30 → sortie le vendredi → Short bonus S+2 → stats S+7) ;
- le dérush A / B / C et les 15 meilleurs plans ;
- l'ordre d'or (l'intro en dernier) ;
- les boucles (toujours 1 à 3 ouvertes) ;
- les placeholders ;
- ton mix (VO −6 / musique −18 / SFX −12, master −14/−16 LUFS) ;
- les feedbacks et les Shorts.

Installation : [TUTORIEL-INSTALLATION.md](TUTORIEL-INSTALLATION.md).

![LOAN Studio](docs/loan-studio.png)

---

## Le parcours d'une vidéo, outil par outil

| Moment (planning) | Ce que tu fais | Outil |
|---|---|---|
| Dès le sujet verrouillé (S−30) | Date de sortie → toutes les échéances | 🏠 Accueil |
| Le soir du tournage | Dérush A/B/C + ⭐ en ×1,5–×2 | 🗂️ Dérush |
| Avant d'ouvrir la timeline | Segments, durées cibles, boucles | 🧱 Structure |
| Avant d'assembler | Proxies pour un montage fluide | ⚡ Proxies |
| Assemblage | Placeholders pour les plans manquants, jump-cut des passages face caméra / VO | 🧱 Structure · ✂️ Blancs |
| Mix | Niveaux VO / musique / SFX en un clic | 🎚️ Audio |
| Avant export (S−7) | Vérif finale, puis feedbacks en marqueurs | ✅ Vérif |
| Après export | Loudness et format du fichier | 🎚️ Audio · ✅ Vérif |
| S−1 / S+2 | Chapitres YouTube, Short bonus 9:16 | 🧱 Structure · 📱 Short |

---

## 🏠 Accueil

- **Date de sortie** : entre le vendredi de sortie. Les 8 échéances de ton protocole se calculent toutes seules, et la prochaine reste affichée en haut du panneau (« Montage fini J−5 »), en orange puis en rouge quand ça approche.
- **Ordre d'or** : tes 13 étapes, de « Structure écrite » à « Export + feedbacks ». L'étape en cours est surlignée, et un clic la coche. LOAN Studio coche aussi tout seul « Dérush » (quand tu crées les SÉLECTS avec tous les rushs notés) et « Vérifs » (quand la vérif finale est entièrement verte).
- **Session de montage** : un minuteur de 15, 25 ou 45 min. À la fin, il te rappelle de t'arrêter **au milieu d'une coupe** (effet Zeigarnik) et d'écrire où tu en es. À la prochaine ouverture du projet, cette note s'affiche en haut : « **Reprise :** finir la coupe du passage piéton… ».
- **Sauvegarder + copie de secours** : enregistre le projet et en copie le `.prproj` horodaté dans `Backups LOAN` (à côté du projet, ou sur ton disque externe via ⚙). Les 20 dernières copies sont gardées.

## 🗂️ Dérush — ta tâche n°1, en mode rapide

1. Double-clique un rush dans le panneau Projet : il s'ouvre dans le **moniteur Source**, et LOAN Studio le reconnaît.
2. Lance la lecture en **×1,5** ou **×2** avec les boutons du panneau.
3. Pendant la lecture :
   - **4** (ou **T**) = ⭐ moment fort, posé à la position du moniteur Source. Écris une note avant si tu veux : « intro possible ».
   - **N** = écrire une note, puis **Entrée** pour poser un marqueur.
4. À la fin du clip : **1** = A 🟢, **2** = B 🟡, **3** = C 🔴. La note devient la couleur d'étiquette du clip dans Premiere, et **le clip suivant non noté s'ouvre tout seul**.
5. La file montre « 142 / 380 notés ». Tu peux la filtrer par chutier (Jour 1, Paris…) et par note.
6. Une fois fini, clique **Créer SÉLECTS + ⭐ TOP** :
   - le chutier `SÉLECTS` contient tous les A (plus les B si tu coches la case), en sous-clips : **tes rushs restent rangés** dans leurs chutiers ;
   - le chutier `⭐ TOP` contient un sous-clip de quelques secondes autour de chaque ⭐ : tes meilleurs plans, prêts pour l'intro et les boucles.
7. **Copier la liste ⭐** : la liste « clip — 0:12 — note », à coller dans Notion.

> Astuce : pose un point d'entrée/sortie dans le moniteur Source sur la bonne partie d'un long rush. Le sous-clip SÉLECTS ne gardera que ce passage.

## 🧱 Structure — ne plus « chercher » en montant

- **Plan de la vidéo** : un segment par ligne (Intro, Phase 1 — Jeux…) avec sa durée cible et l'émotion visée. Le total est comparé à ta durée cible.
- **Importer…** : colle ta structure (« Intro | 0:45 | Curiosité », une ligne par segment) ou **l'export de Loop Builder** (« Exporter les notes »). Les boucles principales, les sous-boucles et les marqueurs sont repris tels quels.
- **Boucles** : chaque question que le spectateur se pose, avec le moment où elle s'ouvre et celui où elle se ferme.
- **Carte de rétention** : segments en haut, boucles au milieu, courbe des boucles ouvertes en bas. Elle signale :
  - 🔴 les passages **sans aucune boucle ouverte** (le spectateur n'a plus de raison de rester) ;
  - 🟠 plus de 3 boucles ouvertes en même temps ;
  - deux segments de suite avec **la même émotion** (« ajoute un contraste »).

  Un clic sur la carte place la tête de lecture de Premiere à ce moment.
- **Poser sur la timeline** : crée les marqueurs `[SEG]` (bleus) et `[LOOP]` (violets) sur ta séquence. En montant, tu sais toujours où tu en es. Quand tu as déplacé des marqueurs dans Premiere, **Lire depuis la timeline** met le plan à jour.
- **Placeholder** : tape un nom (« MANETTE ») et une durée, puis clique. Un carton rouge « PLACEHOLDER » est créé à la taille de ta séquence et posé à la tête de lecture, sur une piste vidéo libre. Il n'écrase jamais rien et ne touche pas à ta musique. La Vérif finale bloque tant qu'il en reste.
- **Chapitres YouTube** : générés depuis tes segments (0:00 obligatoire, au moins 3 chapitres, 10 s minimum chacun). Clique **Copier** et colle-les dans la description.

## ✂️ Blancs — jump-cut automatique

1. Sélectionne dans la timeline un clip face caméra ou une voix off, puis **Prendre le clip sélectionné**.
2. **Analyser** : la barre montre en vert ce qui est gardé et en rouge les blancs, avec le temps gagné (« −34 s, −28 % »).
3. **Créer la séquence sans blancs** : une nouvelle séquence avec seulement les passages parlés, mis bout à bout. L'original n'est pas touché.
   Ou bien **Marqueurs seulement** : des marqueurs `[BLANC]` rouges, pour couper toi-même.
4. Réglages : un **seuil** plus bas (−45 dB) garde plus de passages, un **blanc minimum** plus long garde les respirations, et la **marge** évite de couper le début ou la fin des mots.

## 🎚️ Audio — ton mix en un clic

1. Donne un rôle à chaque piste : A1 = Voix off, A2 = Musique, A3 = SFX (modifiable).
2. **Analyser** : chaque clip est mesuré, et le gain qui l'amène à ta cible s'affiche (crête VO −6, musique −18, SFX −12, réglables).
3. **Appliquer les gains** : le volume de chaque clip est réglé dans Premiere (Ctrl+Z pour annuler). Les clips qui ont déjà des images clés de volume ne sont pas touchés.
4. **Loudness du fichier exporté** : choisis ton export. Tu obtiens le LUFS intégré (cible −14 à −16), la crête vraie (≤ −1 dBTP) et une courbe dans le temps. Les passages trop forts ou presque muets sont listés : un clic y amène la tête de lecture.

## 📱 Short

1. Dans la vidéo longue, pose **I** et **O** autour du moment (15 s à 3 min).
2. **Créer le Short** : une sous-séquence de ce passage, recadrée en **9:16** par l'Auto Reframe de Premiere, s'ouvre.
3. Suis ta structure de Short en cases à cocher : hook 0–3 s (le plan le plus fort) → lieu + objectif → comment je filme → tease → cœur → CTA vers la vidéo longue → dernière image qui renvoie à la première.

## ⚡ Proxies

Sélectionne tes rushs (ou un chutier entier) dans le panneau Projet, choisis **GoPro CineForm 1280** (ton format habituel) ou ProRes Proxy, puis clique **Créer et attacher**.
- Les proxies vont dans un dossier `Proxies` à côté des rushs.
- Ils sont **attachés automatiquement** à tes clips (même ratio, mêmes pistes audio : Premiere les accepte).
- Ensuite, active le bouton **Proxys** du moniteur Programme. L'export utilise toujours les fichiers originaux.

## ✅ Vérif — avant chaque export

**Lancer la vérification** contrôle la séquence active :

| | Contrôle |
|---|---|
| ❌ | **Placeholders** oubliés (avec lien vers chacun) |
| ❌ | **Médias hors ligne** (fichier déplacé ou disque débranché) |
| ⚠️ | **Trous noirs** : aucune image visible à un moment |
| ⚠️ | **Feedbacks** `[FB]` pas encore traités, marqueurs TODO |
| ⚠️ | **Durée** par rapport à ta cible, **rétention** (moments sans boucle ouverte) |
| ⚠️ | **Copie de secours** de plus de 24 h |
| ✅ | Taille de séquence, médias en ligne… |

- **Feedbacks** : colle les retours de tes testeurs (« 2:31 trop long », « à 4min10 le son sature », « 12:05-12:40 coupe ça »). Chaque timecode devient un marqueur orange `[FB]` sur la séquence. Clique « ✓ fait » une fois corrigé : il passe en vert `[OK]`.
- **Fichier exporté** : contrôle la résolution, la cadence et la durée (comparées à la séquence), les étiquettes couleur Rec.709, l'audio et la loudness.

## 🌐 360

Le bouton ouvre **Reframe 360** : recadrage de tes vidéos DJI Osmo 360 / Insta360 avec les objectifs Télé → Crystal Ball et des images clés, en 10 bits. Voir le [tutoriel, partie 8](TUTORIEL-INSTALLATION.md#8-premier-recadrage-360-de-a-à-z).

---

## Raccourcis (panneau LOAN Studio actif)

| Touche | Action (page Dérush) |
|---|---|
| 1 / 2 / 3 | Note A / B / C (+ clip suivant) |
| 4 ou T | ⭐ moment fort à la position Source |
| N | Écrire une note → Entrée = marqueur |
| S ou → | Clip suivant · ← clip précédent |

Les autres touches (Espace, J/K/L…) restent à Premiere.

## Où sont tes données ?

- **Planning, ordre d'or, structure, boucles, note de reprise** : `%APPDATA%\LoanStudio\projects\` (un fichier par projet Premiere).
- **Placeholders** : `LOAN Studio\Placeholders\` à côté de ton `.prproj`.
- **Copies de secours** : `Backups LOAN\` à côté du `.prproj` (ou le dossier choisi dans ⚙).
- **Proxies** : `Proxies\` à côté des rushs.
