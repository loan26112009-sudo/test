// AutoCut Silence - ExtendScript pour Premiere Pro

// Vérifie si une séquence active existe
function checkSequence() {
    if (!app.project) return JSON.stringify({ error: "Aucun projet ouvert." });
    if (!app.project.activeSequence) return JSON.stringify({ error: "Aucune séquence active. Ouvrez une séquence." });
    return null;
}

// Retourne les infos de la séquence active
function getSequenceInfo() {
    var err = checkSequence();
    if (err) return err;

    try {
        var seq = app.project.activeSequence;
        return JSON.stringify({
            name: seq.name,
            duration: seq.end.seconds,
            videoTracks: seq.videoTracks.numTracks,
            audioTracks: seq.audioTracks.numTracks,
            timebase: seq.timebase
        });
    } catch (e) {
        return JSON.stringify({ error: "Erreur séquence : " + e.message });
    }
}

// Retourne les infos des clips audio + vidéo (chemins source)
function getClipsInfo() {
    var err = checkSequence();
    if (err) return err;

    try {
        var seq = app.project.activeSequence;
        var result = { audioClips: [], videoClips: [] };

        // Piste audio (piste 1)
        if (seq.audioTracks.numTracks > 0) {
            var aTrack = seq.audioTracks[0];
            for (var i = 0; i < aTrack.clips.numItems; i++) {
                var clip = aTrack.clips[i];
                var filePath = "";
                try { filePath = clip.projectItem.getMediaPath(); } catch(e2) {}
                result.audioClips.push({
                    name: clip.name,
                    seqStart: clip.start.seconds,
                    seqEnd: clip.end.seconds,
                    srcStart: clip.inPoint.seconds,
                    srcEnd: clip.outPoint.seconds,
                    filePath: filePath
                });
            }
        }

        // Piste vidéo (pour audio embarqué si pas de piste audio séparée)
        if (result.audioClips.length === 0 && seq.videoTracks.numTracks > 0) {
            var vTrack = seq.videoTracks[0];
            for (var i = 0; i < vTrack.clips.numItems; i++) {
                var clip = vTrack.clips[i];
                var filePath = "";
                try { filePath = clip.projectItem.getMediaPath(); } catch(e2) {}
                if (filePath) {
                    result.audioClips.push({
                        name: clip.name,
                        seqStart: clip.start.seconds,
                        seqEnd: clip.end.seconds,
                        srcStart: clip.inPoint.seconds,
                        srcEnd: clip.outPoint.seconds,
                        filePath: filePath,
                        fromVideo: true
                    });
                }
            }
        }

        return JSON.stringify(result);
    } catch (e) {
        return JSON.stringify({ error: "Erreur clips : " + e.message });
    }
}

// Applique les coupes sur la séquence
// silencesJSON : [{start, end}, ...] en secondes dans la timeline
// numVideoTracks : combien de pistes vidéo couper (1 ou 2)
function applySilenceCuts(silencesJSON, numVideoTracksStr) {
    var err = checkSequence();
    if (err) return err;

    try {
        var silences = JSON.parse(silencesJSON);
        var numVideoTracks = parseInt(numVideoTracksStr, 10) || 2;

        if (!silences || silences.length === 0) {
            return JSON.stringify({ error: "Aucun silence à couper." });
        }

        var seq = app.project.activeSequence;

        // Filtre les segments trop courts et trie en ordre INVERSE (pour éviter décalage de positions)
        silences = silences.filter(function(s) { return (s.end - s.start) > 0.05; });
        silences.sort(function(a, b) { return b.start - a.start; });

        var cutsMade = 0;
        var TOLERANCE = 0.05; // 50ms de tolérance pour la correspondance de clips

        for (var i = 0; i < silences.length; i++) {
            var silence = silences[i];
            var startSec = silence.start;
            var endSec = silence.end;

            // On coupe avec Razor sur toute la séquence aux deux extrémités
            var startTime = new Time();
            startTime.seconds = startSec;
            var endTime = new Time();
            endTime.seconds = endSec;

            seq.razor(startTime);
            seq.razor(endTime);

            // --- Pistes vidéo (les N premières) ---
            var videoCount = Math.min(numVideoTracks, seq.videoTracks.numTracks);
            for (var v = 0; v < videoCount; v++) {
                var vTrack = seq.videoTracks[v];
                for (var c = vTrack.clips.numItems - 1; c >= 0; c--) {
                    var vClip = vTrack.clips[c];
                    var cs = vClip.start.seconds;
                    var ce = vClip.end.seconds;
                    if (Math.abs(cs - startSec) < TOLERANCE && Math.abs(ce - endSec) < TOLERANCE) {
                        vClip.remove(true, true); // ripple delete
                        break;
                    }
                }
            }

            // --- Piste audio (première piste) ---
            if (seq.audioTracks.numTracks > 0) {
                var aTrack = seq.audioTracks[0];
                for (var c = aTrack.clips.numItems - 1; c >= 0; c--) {
                    var aClip = aTrack.clips[c];
                    var cs = aClip.start.seconds;
                    var ce = aClip.end.seconds;
                    if (Math.abs(cs - startSec) < TOLERANCE && Math.abs(ce - endSec) < TOLERANCE) {
                        aClip.remove(true, true);
                        break;
                    }
                }
            }

            cutsMade++;
        }

        return JSON.stringify({ success: true, cuts: cutsMade });
    } catch (e) {
        return JSON.stringify({ error: "Erreur application coupes : " + e.message });
    }
}

// Crée des marqueurs visuels pour la prévisualisation des silences
function createPreviewMarkers(silencesJSON) {
    var err = checkSequence();
    if (err) return err;

    try {
        var silences = JSON.parse(silencesJSON);
        var seq = app.project.activeSequence;

        // Supprime les anciens marqueurs AutoCut
        for (var i = seq.markers.numMarkers - 1; i >= 0; i--) {
            var m = seq.markers[i];
            if (m.name === "AutoCut Silence") {
                seq.markers.deleteMarker(m);
            }
        }

        // Crée les nouveaux marqueurs
        for (var i = 0; i < silences.length; i++) {
            var silence = silences[i];
            var t = new Time();
            t.seconds = silence.start;
            var marker = seq.markers.createMarker(t.ticks);
            marker.name = "AutoCut Silence";
            marker.type = 0; // Comment
            try {
                var endT = new Time();
                endT.seconds = silence.end;
                marker.end = endT;
            } catch(e2) {}
        }

        return JSON.stringify({ success: true, count: silences.length });
    } catch (e) {
        return JSON.stringify({ error: "Erreur marqueurs : " + e.message });
    }
}

// Supprime tous les marqueurs AutoCut
function clearPreviewMarkers() {
    var err = checkSequence();
    if (err) return err;
    try {
        var seq = app.project.activeSequence;
        for (var i = seq.markers.numMarkers - 1; i >= 0; i--) {
            var m = seq.markers[i];
            if (m.name === "AutoCut Silence") {
                seq.markers.deleteMarker(m);
            }
        }
        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
