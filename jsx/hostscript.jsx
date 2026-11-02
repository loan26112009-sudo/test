// AutoCut Silence — ExtendScript Premiere Pro

function checkSequence() {
    if (!app.project) return JSON.stringify({ error: "Aucun projet ouvert." });
    if (!app.project.activeSequence) return JSON.stringify({ error: "Aucune séquence active. Ouvrez une séquence." });
    return null;
}

// Infos de la séquence active
function getSequenceInfo() {
    var err = checkSequence();
    if (err) return err;
    try {
        var seq = app.project.activeSequence;
        return JSON.stringify({
            name: seq.name,
            duration: seq.end.seconds,
            videoTracks: seq.videoTracks.numTracks,
            audioTracks: seq.audioTracks.numTracks
        });
    } catch (e) {
        return JSON.stringify({ error: "Erreur séquence : " + e.message });
    }
}

// Retourne les pistes qui ont du contenu (pour affichage dynamique)
function getSequenceTracksInfo() {
    var err = checkSequence();
    if (err) return err;
    try {
        var seq = app.project.activeSequence;
        var tracks = [];

        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var t = seq.videoTracks[v];
            if (t.clips.numItems > 0) {
                tracks.push({ type: "video", index: v, name: "Vidéo " + (v + 1), clips: t.clips.numItems });
            }
        }
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var t = seq.audioTracks[a];
            if (t.clips.numItems > 0) {
                tracks.push({ type: "audio", index: a, name: "Audio " + (a + 1), clips: t.clips.numItems });
            }
        }
        return JSON.stringify({ tracks: tracks });
    } catch (e) {
        return JSON.stringify({ error: "Erreur pistes : " + e.message });
    }
}

// Retourne le chemin du fichier source pour l'analyse audio
function getClipsInfo() {
    var err = checkSequence();
    if (err) return err;
    try {
        var seq = app.project.activeSequence;
        var audioClips = [];

        // Cherche d'abord sur les pistes audio
        if (seq.audioTracks.numTracks > 0) {
            var at = seq.audioTracks[0];
            for (var i = 0; i < at.clips.numItems; i++) {
                var clip = at.clips[i];
                var fp = "";
                try { fp = clip.projectItem.getMediaPath(); } catch(e2) {}
                audioClips.push({
                    name: clip.name,
                    seqStart: clip.start.seconds,
                    seqEnd:   clip.end.seconds,
                    srcStart: clip.inPoint.seconds,
                    srcEnd:   clip.outPoint.seconds,
                    filePath: fp
                });
            }
        }
        // Fallback sur piste vidéo (audio embarqué)
        if (audioClips.length === 0 && seq.videoTracks.numTracks > 0) {
            var vt = seq.videoTracks[0];
            for (var i = 0; i < vt.clips.numItems; i++) {
                var clip = vt.clips[i];
                var fp = "";
                try { fp = clip.projectItem.getMediaPath(); } catch(e2) {}
                if (fp) audioClips.push({
                    name: clip.name,
                    seqStart: clip.start.seconds,
                    seqEnd:   clip.end.seconds,
                    srcStart: clip.inPoint.seconds,
                    srcEnd:   clip.outPoint.seconds,
                    filePath: fp,
                    fromVideo: true
                });
            }
        }
        return JSON.stringify({ audioClips: audioClips });
    } catch (e) {
        return JSON.stringify({ error: "Erreur clips : " + e.message });
    }
}

/**
 * Applique les coupes sur une séquence (originale ou copie).
 * silencesJSON  : [{start, end}, ...] en secondes (ordre décroissant requis)
 * tracksJSON    : [{type:"video"|"audio", index:N}, ...] pistes à couper
 * useCopyStr    : "true" = travaille sur une copie, "false" = modifie directement
 */
function applySilenceCuts(silencesJSON, tracksJSON, useCopyStr) {
    var err = checkSequence();
    if (err) return err;

    try {
        var silences  = JSON.parse(silencesJSON);
        var trackSel  = JSON.parse(tracksJSON);
        var useCopy   = (useCopyStr === "true");

        if (!silences || silences.length === 0) {
            return JSON.stringify({ error: "Aucun silence à couper." });
        }

        var seq = app.project.activeSequence;

        // ── Sécurité : on travaille sur une copie ───────────────────────────
        if (useCopy) {
            var copy = seq.clone();
            if (!copy) return JSON.stringify({ error: "Impossible de dupliquer la séquence." });
            copy.name = seq.name + " — AutoCut";
            seq = copy;
            seq.open(); // Rend la copie active dans Premiere Pro
        }

        // ── Trier en ordre décroissant (obligatoire pour ripple correct) ────
        silences.sort(function(a, b) { return b.start - a.start; });

        var TOLE = 0.06; // tolérance 60ms pour matching post-razor
        var cutsMade = 0;

        for (var i = 0; i < silences.length; i++) {
            var sil = silences[i];
            var startSec = sil.start;
            var endSec   = sil.end;
            if (endSec - startSec < 0.05) continue; // ignore segments < 50ms

            // 1) Razor sur toute la séquence aux deux extrémités
            var tStart = new Time(); tStart.seconds = startSec;
            var tEnd   = new Time(); tEnd.seconds   = endSec;
            seq.razor(tStart);
            seq.razor(tEnd);

            // 2) Supprime sur chaque piste sélectionnée
            for (var t = 0; t < trackSel.length; t++) {
                var ts = trackSel[t];
                var track = ts.type === "video"
                    ? seq.videoTracks[ts.index]
                    : seq.audioTracks[ts.index];

                if (!track) continue;

                // Cherche le clip qui correspond exactement à ce segment
                for (var c = track.clips.numItems - 1; c >= 0; c--) {
                    var clip = track.clips[c];
                    var cs = clip.start.seconds;
                    var ce = clip.end.seconds;
                    if (Math.abs(cs - startSec) < TOLE && Math.abs(ce - endSec) < TOLE) {
                        clip.remove(true, true); // ripple = true, alignToVideo = true
                        break;
                    }
                }
            }

            cutsMade++;
        }

        var resultName = useCopy ? seq.name : "";
        return JSON.stringify({ success: true, cuts: cutsMade, sequenceName: resultName, isCopy: useCopy });

    } catch (e) {
        return JSON.stringify({ error: "Erreur lors des coupes : " + e.message });
    }
}
