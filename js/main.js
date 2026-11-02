/**
 * AutoCut Silence — Interface simplifiée
 * Sécurité : travaille toujours sur une copie par défaut.
 */
(function () {
    "use strict";

    var cs = new CSInterface();
    var audioBuffer      = null;
    var silenceSegments  = [];
    var clipsList        = [];
    var tracksInfo       = [];     // pistes détectées dans la séquence
    var selectedTracks   = [];     // pistes cochées par l'utilisateur

    // ── Presets (invisibles pour l'utilisateur) ────────────────────────────
    var PRESETS = {
        soft:     { thresholdDb: -45, minSilenceMs: 600, paddingMs: 120 },
        balanced: { thresholdDb: -35, minSilenceMs: 300, paddingMs:  60 },
        hard:     { thresholdDb: -25, minSilenceMs: 150, paddingMs:  20 }
    };
    var currentPreset = "balanced";

    // ── DOM ────────────────────────────────────────────────────────────────
    var sdot         = document.getElementById("status-dot");
    var stxt         = document.getElementById("status-text");
    var pwrap        = document.getElementById("progress-bar-wrap");
    var pbar         = document.getElementById("progress-bar");
    var canvas       = document.getElementById("waveform-canvas");
    var wph          = document.getElementById("waveform-placeholder");
    var statsEl      = document.getElementById("silence-stats");
    var tracksSect   = document.getElementById("tracks-section");
    var trackPills   = document.getElementById("track-pills");
    var useCopyChk   = document.getElementById("use-copy");
    var btnPreview   = document.getElementById("btn-preview");
    var btnApply     = document.getElementById("btn-apply");
    var toastEl      = document.getElementById("toast");

    // ── Helpers UI ─────────────────────────────────────────────────────────
    function setStatus(txt, type) {
        stxt.textContent = txt;
        sdot.className = "status-dot " + (type || "");
    }
    function setProgress(pct) {
        pwrap.style.display = pct > 0 ? "block" : "none";
        pbar.style.width = Math.min(100, pct) + "%";
    }
    function showToast(msg, type) {
        toastEl.textContent = msg;
        toastEl.className = "show " + (type || "");
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.className = ""; }, 3200);
    }
    function fmt(s) { return s < 60 ? s.toFixed(1) + "s" : Math.floor(s/60) + "m" + (s%60).toFixed(0) + "s"; }

    // ── Preset selector ────────────────────────────────────────────────────
    document.querySelectorAll(".preset-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".preset-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            currentPreset = btn.dataset.preset;
            if (audioBuffer) reanalyze();
        });
    });

    // ── Track pills (dynamiques après analyse) ─────────────────────────────
    function buildTrackPills(tracks) {
        trackPills.innerHTML = "";
        selectedTracks = tracks.slice(); // toutes sélectionnées par défaut

        tracks.forEach(function (t, i) {
            var pill = document.createElement("button");
            pill.className = "track-pill";
            pill.innerHTML = '<span class="pill-check">✓</span> ' +
                (t.type === "video" ? "🎬" : "🎵") + " " + t.name;
            pill.dataset.idx = i;

            pill.addEventListener("click", function () {
                var idx = parseInt(pill.dataset.idx, 10);
                var pos = selectedTracks.indexOf(tracks[idx]);

                if (pos !== -1) {
                    // Déselectionner seulement si au moins 1 autre reste sélectionné
                    if (selectedTracks.length > 1) {
                        selectedTracks.splice(pos, 1);
                        pill.classList.add("off");
                        pill.querySelector(".pill-check").textContent = "○";
                    }
                } else {
                    selectedTracks.push(tracks[idx]);
                    pill.classList.remove("off");
                    pill.querySelector(".pill-check").textContent = "✓";
                }
            });

            trackPills.appendChild(pill);
        });

        tracksSect.style.display = "block";
    }

    // ── Communication Premiere Pro ─────────────────────────────────────────
    function evalScript(script) {
        return new Promise(function (resolve) {
            cs.evalScript(script, function (r) { resolve(r || '{}'); });
        });
    }

    function loadClips() {
        return evalScript("getClipsInfo()").then(function (raw) {
            try {
                var d = JSON.parse(raw);
                if (d.error) { setStatus(d.error, "error"); return null; }
                clipsList = d.audioClips || [];
                return clipsList;
            } catch (e) { return null; }
        });
    }

    function loadTracksInfo() {
        return evalScript("getSequenceTracksInfo()").then(function (raw) {
            try {
                var d = JSON.parse(raw);
                if (d.error || !d.tracks) return [];
                return d.tracks;
            } catch (e) { return []; }
        });
    }

    // ── Lecture fichier audio (Node.js ou fetch file://) ───────────────────
    function readFileBuffer(path) {
        return new Promise(function (resolve, reject) {
            var fs = null;
            try { fs = require("fs"); } catch (e) {
                try { fs = window.require("fs"); } catch (e2) {}
            }
            if (fs) {
                try {
                    var buf = fs.readFileSync(path);
                    resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
                } catch (e) { reject(new Error("Lecture impossible : " + e.message)); }
            } else {
                fetch("file:///" + path.replace(/\\/g, "/").replace(/^\//, ""))
                    .then(function (r) { return r.arrayBuffer(); })
                    .then(resolve)
                    .catch(function () { reject(new Error("Fichier source inaccessible.")); });
            }
        });
    }

    function decodeAudio(ab) {
        return new Promise(function (resolve, reject) {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            ctx.decodeAudioData(ab.slice(0), resolve, reject);
        });
    }

    // ── Détection silences ─────────────────────────────────────────────────
    function detectSilences(buf, presetKey, clip) {
        var p       = PRESETS[presetKey];
        var sr      = buf.sampleRate;
        var thrLin  = Math.pow(10, p.thresholdDb / 20);
        var minSmp  = Math.floor(p.minSilenceMs  / 1000 * sr);
        var padSmp  = Math.floor(p.paddingMs     / 1000 * sr);
        var win     = Math.floor(sr * 0.01); // fenêtres de 10ms
        var numCh   = buf.numberOfChannels;
        var chs     = [];
        for (var c = 0; c < numCh; c++) chs.push(buf.getChannelData(c));

        var silStart = -1, result = [], n = buf.length;

        for (var i = 0; i < n; i += win) {
            var end = Math.min(i + win, n);
            var sq  = 0;
            for (var j = i; j < end; j++) {
                var s = 0;
                for (var ch = 0; ch < numCh; ch++) s += chs[ch][j];
                s /= numCh; sq += s * s;
            }
            var rms = Math.sqrt(sq / (end - i));

            if (rms < thrLin) {
                if (silStart < 0) silStart = i;
            } else {
                if (silStart >= 0) {
                    if (i - silStart >= minSmp) {
                        var ss = Math.max(0, silStart + padSmp);
                        var se = Math.max(ss + win, i - padSmp);
                        var offset = (clip.seqStart || 0) - (clip.srcStart || 0);
                        result.push({
                            _s: ss, _e: se,
                            start: ss / sr + (clip.srcStart || 0) + offset,
                            end:   se / sr + (clip.srcStart || 0) + offset
                        });
                    }
                    silStart = -1;
                }
            }
        }
        // Dernier segment
        if (silStart >= 0 && n - silStart >= minSmp) {
            var ss = Math.max(0, silStart + padSmp);
            var se = Math.max(ss + win, n - padSmp);
            var offset = (clip.seqStart || 0) - (clip.srcStart || 0);
            result.push({ _s: ss, _e: se,
                start: ss / sr + (clip.srcStart || 0) + offset,
                end:   se / sr + (clip.srcStart || 0) + offset
            });
        }
        return result;
    }

    // ── Waveform canvas ────────────────────────────────────────────────────
    function drawWaveform(buf, sils) {
        var ctx = canvas.getContext("2d");
        var W = canvas.offsetWidth, H = canvas.offsetHeight;
        canvas.width = W; canvas.height = H;
        ctx.fillStyle = "#1e1e32";
        ctx.fillRect(0, 0, W, H);
        if (!buf) return;

        var data = buf.getChannelData(0), n = data.length;
        var mid = H / 2, block = Math.max(1, Math.floor(n / W));

        // Zones silence (fond rouge)
        ctx.fillStyle = "rgba(239,68,68,.2)";
        sils.forEach(function (s) {
            var x0 = Math.floor(s._s / n * W);
            var x1 = Math.ceil(s._e  / n * W);
            ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        });

        // Waveform
        ctx.beginPath(); ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1;
        for (var x = 0; x < W; x++) {
            var f = x * block, t = Math.min(f + block, n);
            var mn = 0, mx = 0;
            for (var j = f; j < t; j++) {
                if (data[j] < mn) mn = data[j];
                if (data[j] > mx) mx = data[j];
            }
            ctx.moveTo(x + .5, mid + mn * mid * .9);
            ctx.lineTo(x + .5, mid + mx * mid * .9);
        }
        ctx.stroke();

        // Bordures silences
        ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        sils.forEach(function (s) {
            var x0 = Math.floor(s._s / n * W);
            var x1 = Math.ceil(s._e  / n * W);
            ctx.beginPath(); ctx.moveTo(x0+.5, 0); ctx.lineTo(x0+.5, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x1-.5, 0); ctx.lineTo(x1-.5, H); ctx.stroke();
        });
        ctx.setLineDash([]);
        wph.style.display = "none";
    }

    // ── Stats ──────────────────────────────────────────────────────────────
    function updateStats(sils, dur) {
        statsEl.innerHTML = "";
        var total = sils.reduce(function (a, s) { return a + (s.end - s.start); }, 0);
        var pct = dur > 0 ? Math.round(total / dur * 100) : 0;
        [
            { t: sils.length + " silence" + (sils.length !== 1 ? "s" : ""), cls: sils.length > 0 ? "red" : "" },
            { t: fmt(total) + " à supprimer", cls: total > 0 ? "red" : "" },
            { t: pct + "% du clip",           cls: pct > 0 ? "acc" : "" }
        ].forEach(function (d) {
            var el = document.createElement("span");
            el.className = "stat-chip " + d.cls;
            el.textContent = d.t;
            statsEl.appendChild(el);
        });
    }

    // ── Re-analyse sans re-charger le fichier ──────────────────────────────
    function reanalyze() {
        if (!audioBuffer) return;
        var clip = clipsList[0] || {};
        setTimeout(function () {
            silenceSegments = detectSilences(audioBuffer, currentPreset, clip);
            drawWaveform(audioBuffer, silenceSegments);
            updateStats(silenceSegments, audioBuffer.duration);
            var n = silenceSegments.length;
            setStatus(n > 0 ? n + " silence(s) — Prêt !" : "Aucun silence — essaie Agressif", n > 0 ? "ok" : "");
            btnApply.disabled = n === 0;
        }, 0);
    }

    // ── Générer Aperçu ────────────────────────────────────────────────────
    btnPreview.addEventListener("click", function () {
        btnPreview.disabled = true;
        btnApply.disabled   = true;
        audioBuffer         = null;
        silenceSegments     = [];
        tracksSect.style.display = "none";
        wph.style.display   = "flex";
        drawWaveform(null, []);
        statsEl.innerHTML   = "";

        setStatus("Connexion à Premiere Pro...", "working");
        setProgress(10);

        evalScript("getSequenceInfo()").then(function (raw) {
            var seq = null;
            try { seq = JSON.parse(raw); } catch (e) {}
            if (!seq || seq.error) {
                setStatus(seq && seq.error ? seq.error : "Ouvrez une séquence dans Premiere Pro.", "error");
                setProgress(0); btnPreview.disabled = false; return Promise.reject("no seq");
            }
            setProgress(20); setStatus("Lecture des pistes...", "working");
            // Charge clips et infos pistes en parallèle
            return Promise.all([loadClips(), loadTracksInfo()]);
        }).then(function (results) {
            if (!results) return;
            var clips  = results[0];
            var tracks = results[1];

            if (!clips || clips.length === 0) {
                setStatus("Aucun clip audio trouvé dans la séquence.", "error");
                setProgress(0); btnPreview.disabled = false; return;
            }

            // Affiche les pistes détectées
            tracksInfo = tracks && tracks.length > 0 ? tracks : [];
            if (tracksInfo.length > 0) buildTrackPills(tracksInfo);

            var clip = clips[0];
            if (!clip.filePath) {
                setStatus("Chemin source introuvable.", "error");
                setProgress(0); btnPreview.disabled = false; return;
            }

            setProgress(40); setStatus("Lecture du fichier audio...", "working");

            readFileBuffer(clip.filePath).then(function (ab) {
                setProgress(65); setStatus("Analyse en cours...", "working");
                decodeAudio(ab).then(function (buf) {
                    audioBuffer = buf;
                    setProgress(85);
                    setTimeout(function () {
                        silenceSegments = detectSilences(buf, currentPreset, clip);
                        drawWaveform(buf, silenceSegments);
                        updateStats(silenceSegments, buf.duration);
                        setProgress(0);
                        var n = silenceSegments.length;
                        setStatus(n > 0 ? n + " silence(s) détecté(s) — Prêt !" : "Aucun silence — essaie Agressif", n > 0 ? "ok" : "");
                        btnPreview.disabled = false;
                        btnApply.disabled   = n === 0;
                    }, 0);
                }).catch(function () {
                    setStatus("Format non supporté. Utilise un MP4 ou WAV.", "error");
                    setProgress(0); btnPreview.disabled = false;
                });
            }).catch(function (e) {
                setStatus(e.message, "error");
                setProgress(0); btnPreview.disabled = false;
            });
        }).catch(function () {
            setProgress(0); btnPreview.disabled = false;
        });
    });

    // ── Couper les silences ───────────────────────────────────────────────
    btnApply.addEventListener("click", function () {
        if (!silenceSegments.length) return;

        // Construit la liste des pistes sélectionnées
        var trackSelection = selectedTracks.length > 0
            ? selectedTracks
            : tracksInfo; // fallback : toutes si rien sélectionné

        // Si aucune info piste (Pr non connecté), utilise toutes (index 0,1)
        if (trackSelection.length === 0) {
            trackSelection = [
                { type: "video", index: 0 },
                { type: "video", index: 1 },
                { type: "audio", index: 0 }
            ];
        }

        var useCopy = useCopyChk.checked;

        btnPreview.disabled = true;
        btnApply.disabled   = true;
        setStatus(useCopy ? "Création d'une copie..." : "Application des coupes...", "working");
        setProgress(15);

        var seqSils = silenceSegments
            .filter(function (s) { return s.end - s.start > 0.05; })
            .sort(function (a, b) { return b.start - a.start; })
            .map(function (s) { return { start: s.start, end: s.end }; });

        var silJSON   = JSON.stringify(seqSils).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        var trackJSON = JSON.stringify(trackSelection).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

        evalScript(
            "applySilenceCuts('" + silJSON + "', '" + trackJSON + "', '" + (useCopy ? "true" : "false") + "')"
        ).then(function (raw) {
            setProgress(0);
            try {
                var r = JSON.parse(raw);
                if (r.error) {
                    setStatus("Erreur : " + r.error, "error");
                    showToast(r.error, "err");
                    btnPreview.disabled = false;
                } else {
                    var msg = r.isCopy
                        ? "✓ " + r.cuts + " coupe(s) dans « " + r.sequenceName + " »"
                        : "✓ " + r.cuts + " silence(s) supprimé(s)";
                    setStatus(msg, "ok");
                    showToast(msg, "ok");
                    // Reset pour une nouvelle analyse
                    audioBuffer = null; silenceSegments = [];
                    wph.style.display = "flex";
                    drawWaveform(null, []);
                    statsEl.innerHTML = "";
                    tracksSect.style.display = "none";
                    btnPreview.disabled = false;
                    btnApply.disabled   = true;
                }
            } catch (e) {
                setStatus("Réponse inattendue.", "error");
                btnPreview.disabled = false;
            }
        });
    });

    // ── Init ──────────────────────────────────────────────────────────────
    if (cs.isLoaded()) {
        evalScript("getSequenceInfo()").then(function (raw) {
            try {
                var d = JSON.parse(raw);
                if (d && !d.error) setStatus("Séquence « " + d.name + " » — Cliquez Générer l'Aperçu", "ok");
                else setStatus("Ouvrez une séquence dans Premiere Pro", "");
            } catch (e) { setStatus("Ouvrez une séquence dans Premiere Pro", ""); }
        });
    } else {
        setStatus("Ouvrez ce panel dans Premiere Pro", "");
    }

    new ResizeObserver(function () {
        if (audioBuffer) drawWaveform(audioBuffer, silenceSegments);
    }).observe(canvas);

}());
