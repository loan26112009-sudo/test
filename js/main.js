/**
 * AutoCut Silence — v1.1
 * Zoom waveform + click pour toggle zones + auto-analyse au démarrage
 */
(function () {
    "use strict";

    var cs = new CSInterface();
    var audioBuffer     = null;
    var silenceSegments = [];
    var clipsList       = [];
    var tracksInfo      = [];
    var selectedTracks  = [];

    // ── Zoom / pan state ────────────────────────────────────────────────────
    var viewStart  = 0;
    var viewEnd    = 1;
    var panStart   = null;   // {x, vs, ve} quand on fait glisser
    var pendingToggle = -1;  // index de silence à basculer au mouseup

    // ── Presets ──────────────────────────────────────────────────────────────
    var PRESETS = {
        soft:     { thresholdDb: -45, minSilenceMs: 600, paddingMs: 120 },
        balanced: { thresholdDb: -35, minSilenceMs: 300, paddingMs:  60 },
        hard:     { thresholdDb: -25, minSilenceMs: 150, paddingMs:  20 }
    };
    var currentPreset = "balanced";
    var advancedMode  = false;

    // ── DOM ──────────────────────────────────────────────────────────────────
    var sdot          = document.getElementById("status-dot");
    var stxt          = document.getElementById("status-text");
    var pwrap         = document.getElementById("progress-bar-wrap");
    var pbar          = document.getElementById("progress-bar");
    var canvas        = document.getElementById("waveform-canvas");
    var minimap       = document.getElementById("minimap-canvas");
    var wph           = document.getElementById("waveform-placeholder");
    var waveHint      = document.getElementById("waveform-hint");
    var statsEl       = document.getElementById("silence-stats");
    var tracksSect    = document.getElementById("tracks-section");
    var trackPills    = document.getElementById("track-pills");
    var useCopyChk    = document.getElementById("use-copy");
    var advToggleBtn  = document.getElementById("advanced-toggle");
    var advPanel      = document.getElementById("advanced-panel");
    var advThreshold  = document.getElementById("adv-threshold");
    var advThreshVal  = document.getElementById("adv-threshold-val");
    var advMinSil     = document.getElementById("adv-min-silence");
    var advMinSilVal  = document.getElementById("adv-min-silence-val");
    var advPadding    = document.getElementById("adv-padding");
    var advPaddingVal = document.getElementById("adv-padding-val");
    var btnPreview    = document.getElementById("btn-preview");
    var btnApply      = document.getElementById("btn-apply");
    var toastEl       = document.getElementById("toast");

    // ── Helpers UI ───────────────────────────────────────────────────────────
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
    function fmt(s) { return s < 60 ? s.toFixed(1) + "s" : Math.floor(s/60) + "m" + (s%60|0) + "s"; }

    function updateApplyBtn() {
        var n = silenceSegments.filter(function(s){ return s.enabled; }).length;
        btnApply.disabled = n === 0;
    }

    // ── Advanced params ──────────────────────────────────────────────────────
    function getActiveParams() {
        if (advancedMode) {
            return {
                thresholdDb:  parseInt(advThreshold.value, 10),
                minSilenceMs: parseInt(advMinSil.value, 10),
                paddingMs:    parseInt(advPadding.value, 10)
            };
        }
        return PRESETS[currentPreset];
    }

    function syncSlidersToPreset(key) {
        var p = PRESETS[key];
        advThreshold.value  = p.thresholdDb;   advThreshVal.textContent  = p.thresholdDb  + " dB";
        advMinSil.value     = p.minSilenceMs;  advMinSilVal.textContent  = p.minSilenceMs + " ms";
        advPadding.value    = p.paddingMs;     advPaddingVal.textContent = p.paddingMs    + " ms";
    }
    syncSlidersToPreset("balanced");

    advToggleBtn.addEventListener("click", function () {
        var open = advPanel.style.display === "none";
        advPanel.style.display = open ? "flex" : "none";
        advToggleBtn.classList.toggle("open", open);
        advancedMode = open;
        if (!open && audioBuffer) reanalyze();
    });

    [advThreshold, advMinSil, advPadding].forEach(function (el) {
        el.addEventListener("input", function () {
            advThreshVal.textContent  = advThreshold.value  + " dB";
            advMinSilVal.textContent  = advMinSil.value     + " ms";
            advPaddingVal.textContent = advPadding.value    + " ms";
            document.querySelectorAll(".preset-btn").forEach(function(b){ b.classList.remove("active"); });
        });
        el.addEventListener("change", function () { if (audioBuffer) reanalyze(); });
    });

    // ── Preset selector ───────────────────────────────────────────────────────
    document.querySelectorAll(".preset-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".preset-btn").forEach(function(b){ b.classList.remove("active"); });
            btn.classList.add("active");
            currentPreset = btn.dataset.preset;
            advancedMode  = false;
            syncSlidersToPreset(currentPreset);
            if (audioBuffer) reanalyze();
        });
    });

    // ── Track pills ───────────────────────────────────────────────────────────
    function buildTrackPills(tracks) {
        trackPills.innerHTML = "";
        selectedTracks = tracks.slice();
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

    // ── Zoom / pan helpers ────────────────────────────────────────────────────
    function clampView() {
        var range = Math.max(0.02, Math.min(1, viewEnd - viewStart));
        if (viewStart < 0)  { viewStart = 0;        viewEnd = range; }
        if (viewEnd   > 1)  { viewEnd   = 1;         viewStart = 1 - range; }
    }

    function getSilenceAtFrac(frac) {
        if (!audioBuffer || !silenceSegments.length) return -1;
        var n    = audioBuffer.length;
        var samp = (viewStart + frac * (viewEnd - viewStart)) * n;
        for (var i = 0; i < silenceSegments.length; i++) {
            var s = silenceSegments[i];
            if (samp >= s._s && samp <= s._e) return i;
        }
        return -1;
    }

    // Mouse wheel → zoom
    canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        if (!audioBuffer) return;
        var rect   = canvas.getBoundingClientRect();
        var frac   = (e.clientX - rect.left) / rect.width;
        var pivot  = viewStart + frac * (viewEnd - viewStart);
        var factor = e.deltaY > 0 ? 1.35 : (1 / 1.35);
        var range  = Math.min(1, Math.max(0.02, (viewEnd - viewStart) * factor));
        viewStart  = pivot - frac * range;
        viewEnd    = viewStart + range;
        clampView();
        drawWaveform(audioBuffer, silenceSegments);
        drawMinimap(audioBuffer, silenceSegments);
    }, { passive: false });

    // Mousedown → détecter si on clique sur un silence ou sur fond (pan)
    canvas.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        var rect = canvas.getBoundingClientRect();
        var frac = (e.clientX - rect.left) / rect.width;
        var hit  = getSilenceAtFrac(frac);
        if (hit >= 0) {
            pendingToggle = hit;
            panStart = null;
        } else {
            panStart = { x: e.clientX, vs: viewStart, ve: viewEnd };
            pendingToggle = -1;
        }
        e.preventDefault();
    });

    document.addEventListener("mousemove", function (e) {
        if (!panStart) return;
        pendingToggle = -1; // drag annule le toggle prévu
        var rect  = canvas.getBoundingClientRect();
        var dx    = (panStart.x - e.clientX) / rect.width;
        var range = panStart.ve - panStart.vs;
        viewStart = panStart.vs + dx * range;
        viewEnd   = viewStart + range;
        clampView();
        drawWaveform(audioBuffer, silenceSegments);
        drawMinimap(audioBuffer, silenceSegments);
    });

    document.addEventListener("mouseup", function () {
        if (pendingToggle >= 0 && audioBuffer) {
            var sil = silenceSegments[pendingToggle];
            if (sil) {
                sil.enabled = !sil.enabled;
                drawWaveform(audioBuffer, silenceSegments);
                drawMinimap(audioBuffer, silenceSegments);
                updateStats(silenceSegments, audioBuffer.duration);
                updateApplyBtn();
            }
        }
        panStart      = null;
        pendingToggle = -1;
    });

    canvas.addEventListener("mousemove", function (e) {
        if (!audioBuffer) return;
        var rect = canvas.getBoundingClientRect();
        var frac = (e.clientX - rect.left) / rect.width;
        if (getSilenceAtFrac(frac) >= 0) {
            canvas.style.cursor = "pointer";
        } else if (viewEnd - viewStart < 0.98) {
            canvas.style.cursor = panStart ? "grabbing" : "grab";
        } else {
            canvas.style.cursor = "default";
        }
    });

    canvas.addEventListener("mouseleave", function () { canvas.style.cursor = "default"; });

    // Minimap click → centrer la vue
    minimap.addEventListener("click", function (e) {
        if (!audioBuffer) return;
        var rect  = minimap.getBoundingClientRect();
        var frac  = (e.clientX - rect.left) / rect.width;
        var range = viewEnd - viewStart;
        viewStart = Math.max(0, frac - range / 2);
        viewEnd   = Math.min(1, viewStart + range);
        clampView();
        drawWaveform(audioBuffer, silenceSegments);
        drawMinimap(audioBuffer, silenceSegments);
    });

    // ── Draw waveform (avec zoom) ─────────────────────────────────────────────
    function drawWaveform(buf, sils) {
        var ctx = canvas.getContext("2d");
        var W = canvas.offsetWidth, H = canvas.offsetHeight;
        canvas.width = W; canvas.height = H;
        ctx.fillStyle = "#242428";
        ctx.fillRect(0, 0, W, H);
        if (!buf) return;

        var data  = buf.getChannelData(0);
        var n     = buf.length;
        var s0    = Math.floor(viewStart * n);
        var s1    = Math.floor(viewEnd   * n);
        var viewN = s1 - s0;
        var block = Math.max(1, Math.floor(viewN / W));
        var mid   = H / 2;

        // Fond des zones silence
        sils.forEach(function (s) {
            var x0 = Math.floor((s._s - s0) / viewN * W);
            var x1 = Math.ceil( (s._e - s0) / viewN * W);
            if (x1 < 0 || x0 > W) return;
            x0 = Math.max(0, x0); x1 = Math.min(W, x1);
            ctx.fillStyle = s.enabled ? "rgba(239,68,68,.14)" : "rgba(249,115,22,.1)";
            ctx.fillRect(x0, 0, x1 - x0, H);
        });

        // Waveform
        ctx.beginPath(); ctx.strokeStyle = "#7c7cfc"; ctx.lineWidth = 1;
        for (var x = 0; x < W; x++) {
            var f  = s0 + x * block;
            var t  = Math.min(f + block, s1);
            var mn = 0, mx = 0;
            for (var j = f; j < t; j++) {
                if (data[j] < mn) mn = data[j];
                if (data[j] > mx) mx = data[j];
            }
            ctx.moveTo(x + .5, mid + mn * mid * .9);
            ctx.lineTo(x + .5, mid + mx * mid * .9);
        }
        ctx.stroke();

        // Bordures des zones silence
        sils.forEach(function (s) {
            var x0 = (s._s - s0) / viewN * W;
            var x1 = (s._e - s0) / viewN * W;
            if (x1 < 0 || x0 > W) return;
            ctx.strokeStyle = s.enabled ? "rgba(239,68,68,.65)" : "rgba(249,115,22,.6)";
            ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
            if (x0 >= 0 && x0 <= W) { ctx.beginPath(); ctx.moveTo(x0+.5, 0); ctx.lineTo(x0+.5, H); ctx.stroke(); }
            if (x1 >= 0 && x1 <= W) { ctx.beginPath(); ctx.moveTo(x1-.5, 0); ctx.lineTo(x1-.5, H); ctx.stroke(); }
        });
        ctx.setLineDash([]);

        // Règle de temps (quand zoomé)
        if (viewEnd - viewStart < 0.5 && buf.duration > 0) {
            ctx.fillStyle = "rgba(20,20,22,.75)";
            ctx.fillRect(0, H - 13, W, 13);
            ctx.fillStyle = "rgba(255,255,255,.45)";
            ctx.font = "8px monospace";
            var dur = buf.duration;
            for (var step = 0; step <= 8; step++) {
                var fr  = step / 8;
                var sec = (viewStart + fr * (viewEnd - viewStart)) * dur;
                var xp  = fr * W;
                ctx.fillStyle = "rgba(255,255,255,.25)";
                ctx.fillRect(xp, H - 13, 1, 4);
                if (step > 0 && step < 8) {
                    ctx.fillStyle = "rgba(255,255,255,.45)";
                    ctx.fillText(sec.toFixed(1) + "s", xp + 2, H - 2);
                }
            }
        }

        wph.style.display = "none";
    }

    // ── Draw minimap ──────────────────────────────────────────────────────────
    function drawMinimap(buf, sils) {
        if (!buf) return;
        minimap.removeAttribute("hidden");
        var ctx = minimap.getContext("2d");
        var W = minimap.offsetWidth, H = minimap.offsetHeight;
        minimap.width = W; minimap.height = H;
        ctx.fillStyle = "#1c1c1f"; ctx.fillRect(0, 0, W, H);

        var data  = buf.getChannelData(0);
        var n     = buf.length;
        var block = Math.max(1, Math.floor(n / W));
        var mid   = H / 2;

        ctx.beginPath(); ctx.strokeStyle = "rgba(124,124,252,.38)"; ctx.lineWidth = 1;
        for (var x = 0; x < W; x++) {
            var f = x * block, t = Math.min(f + block, n), mn = 0, mx = 0;
            for (var j = f; j < t; j++) {
                if (data[j] < mn) mn = data[j];
                if (data[j] > mx) mx = data[j];
            }
            ctx.moveTo(x+.5, mid+mn*mid*.9); ctx.lineTo(x+.5, mid+mx*mid*.9);
        }
        ctx.stroke();

        sils.forEach(function (s) {
            var x0 = s._s / n * W, x1 = s._e / n * W;
            ctx.fillStyle = s.enabled ? "rgba(239,68,68,.28)" : "rgba(249,115,22,.22)";
            ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        });

        // Fenêtre de zoom
        if (viewEnd - viewStart < 0.99) {
            var vx0 = viewStart * W, vw = (viewEnd - viewStart) * W;
            ctx.fillStyle   = "rgba(249,115,22,.1)";
            ctx.strokeStyle = "rgba(249,115,22,.5)";
            ctx.lineWidth   = 1;
            ctx.fillRect(vx0, 0, vw, H);
            ctx.strokeRect(vx0 + .5, .5, vw - 1, H - 1);
        }

        waveHint.style.display = "flex";
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function updateStats(sils, dur) {
        statsEl.innerHTML = "";
        var on  = sils.filter(function(s){ return s.enabled; });
        var off = sils.length - on.length;
        var tot = on.reduce(function(a, s){ return a + (s.end - s.start); }, 0);
        var pct = dur > 0 ? Math.round(tot / dur * 100) : 0;
        [
            { t: on.length + " silence(s)",    cls: on.length > 0 ? "red" : "" },
            { t: fmt(tot) + " à supprimer",    cls: tot > 0 ? "red" : "" },
            { t: pct + "% du clip",             cls: pct > 0 ? "acc" : "" }
        ].forEach(function (d) {
            var el = document.createElement("span");
            el.className = "stat-chip " + d.cls;
            el.textContent = d.t;
            statsEl.appendChild(el);
        });
        if (off > 0) {
            var el = document.createElement("span");
            el.className = "stat-chip";
            el.textContent = off + " exclu(s)";
            statsEl.appendChild(el);
        }
    }

    // ── Détection silences ────────────────────────────────────────────────────
    function detectSilences(buf, params, clip) {
        var p      = params;
        var sr     = buf.sampleRate;
        var thrLin = Math.pow(10, p.thresholdDb / 20);
        var minSmp = Math.floor(p.minSilenceMs / 1000 * sr);
        var padSmp = Math.floor(p.paddingMs    / 1000 * sr);
        var win    = Math.floor(sr * 0.01);
        var numCh  = buf.numberOfChannels;
        var chs    = [];
        for (var c = 0; c < numCh; c++) chs.push(buf.getChannelData(c));

        var silStart = -1, result = [], n = buf.length;

        for (var i = 0; i < n; i += win) {
            var end = Math.min(i + win, n), sq = 0;
            for (var j = i; j < end; j++) {
                var sv = 0;
                for (var ch = 0; ch < numCh; ch++) sv += chs[ch][j];
                sv /= numCh; sq += sv * sv;
            }
            var rms = Math.sqrt(sq / (end - i));

            if (rms < thrLin) {
                if (silStart < 0) silStart = i;
            } else {
                if (silStart >= 0) {
                    if (i - silStart >= minSmp) {
                        var ss = Math.max(0, silStart + padSmp);
                        var se = Math.max(ss + win, i - padSmp);
                        var off2 = (clip.seqStart || 0) - (clip.srcStart || 0);
                        result.push({ _s: ss, _e: se, enabled: true,
                            start: ss / sr + (clip.srcStart || 0) + off2,
                            end:   se / sr + (clip.srcStart || 0) + off2 });
                    }
                    silStart = -1;
                }
            }
        }
        if (silStart >= 0 && n - silStart >= minSmp) {
            var ss = Math.max(0, silStart + padSmp);
            var se = Math.max(ss + win, n - padSmp);
            var off2 = (clip.seqStart || 0) - (clip.srcStart || 0);
            result.push({ _s: ss, _e: se, enabled: true,
                start: ss / sr + (clip.srcStart || 0) + off2,
                end:   se / sr + (clip.srcStart || 0) + off2 });
        }
        return result;
    }

    // ── Re-analyse (sans recharger l'audio) ──────────────────────────────────
    function reanalyze() {
        if (!audioBuffer) return;
        var clip = clipsList[0] || {};
        setTimeout(function () {
            silenceSegments = detectSilences(audioBuffer, getActiveParams(), clip);
            drawWaveform(audioBuffer, silenceSegments);
            drawMinimap(audioBuffer, silenceSegments);
            updateStats(silenceSegments, audioBuffer.duration);
            var n = silenceSegments.filter(function(s){ return s.enabled; }).length;
            setStatus(n > 0 ? n + " silence(s) — Prêt !" : "Aucun silence — essaie Agressif", n > 0 ? "ok" : "");
            updateApplyBtn();
        }, 0);
    }

    // ── Premiere Pro bridge ───────────────────────────────────────────────────
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

    // ── Lecture fichier audio ─────────────────────────────────────────────────
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

    // ── Analyse principale ────────────────────────────────────────────────────
    function runPreview() {
        btnPreview.disabled = true;
        btnApply.disabled   = true;
        audioBuffer         = null;
        silenceSegments     = [];
        viewStart = 0; viewEnd = 1;
        tracksSect.style.display = "none";
        wph.style.display        = "flex";
        minimap.setAttribute("hidden", "");
        waveHint.style.display   = "none";
        drawWaveform(null, []);
        statsEl.innerHTML = "";

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
            return Promise.all([loadClips(), loadTracksInfo()]);
        }).then(function (results) {
            if (!results) return;
            var clips  = results[0];
            var tracks = results[1];

            if (!clips || clips.length === 0) {
                setStatus("Aucun clip audio trouvé.", "error");
                setProgress(0); btnPreview.disabled = false; return;
            }

            tracksInfo = tracks && tracks.length > 0 ? tracks : [];
            if (tracksInfo.length > 0) buildTrackPills(tracksInfo);

            var clip = clips[0];
            if (!clip.filePath) {
                setStatus("Chemin source introuvable.", "error");
                setProgress(0); btnPreview.disabled = false; return;
            }

            setProgress(40); setStatus("Lecture du fichier audio...", "working");

            readFileBuffer(clip.filePath).then(function (ab) {
                setProgress(65); setStatus("Détection des silences...", "working");
                decodeAudio(ab).then(function (buf) {
                    audioBuffer = buf;
                    setProgress(88);
                    setTimeout(function () {
                        silenceSegments = detectSilences(buf, getActiveParams(), clip);
                        drawWaveform(buf, silenceSegments);
                        drawMinimap(buf, silenceSegments);
                        updateStats(silenceSegments, buf.duration);
                        setProgress(0);
                        var n = silenceSegments.filter(function(s){ return s.enabled; }).length;
                        setStatus(n > 0 ? n + " silence(s) détecté(s) — Prêt !" : "Aucun silence détecté", n > 0 ? "ok" : "");
                        btnPreview.disabled = false;
                        updateApplyBtn();
                    }, 0);
                }).catch(function () {
                    setStatus("Format audio non supporté (MP4/WAV requis).", "error");
                    setProgress(0); btnPreview.disabled = false;
                });
            }).catch(function (e) {
                setStatus(e.message, "error");
                setProgress(0); btnPreview.disabled = false;
            });
        }).catch(function () {
            setProgress(0); btnPreview.disabled = false;
        });
    }

    btnPreview.addEventListener("click", runPreview);

    // ── Couper les silences ───────────────────────────────────────────────────
    btnApply.addEventListener("click", function () {
        var enabledSils = silenceSegments.filter(function(s){ return s.enabled; });
        if (!enabledSils.length) return;

        var trackSelection = selectedTracks.length > 0 ? selectedTracks : tracksInfo;
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
        setStatus(useCopy ? "Création de la copie..." : "Application des coupes...", "working");
        setProgress(15);

        var seqSils = enabledSils
            .filter(function(s){ return s.end - s.start > 0.05; })
            .sort(function(a, b){ return b.start - a.start; })
            .map(function(s){ return { start: s.start, end: s.end }; });

        var silJSON   = JSON.stringify(seqSils).replace(/\\/g,"\\\\").replace(/'/g,"\\'");
        var trackJSON = JSON.stringify(trackSelection).replace(/\\/g,"\\\\").replace(/'/g,"\\'");

        evalScript("applySilenceCuts('" + silJSON + "','" + trackJSON + "','" + (useCopy?"true":"false") + "')").then(function (raw) {
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
                    setStatus(msg, "ok"); showToast(msg, "ok");
                    audioBuffer = null; silenceSegments = [];
                    viewStart = 0; viewEnd = 1;
                    wph.style.display = "flex";
                    minimap.setAttribute("hidden", "");
                    waveHint.style.display = "none";
                    drawWaveform(null, []); statsEl.innerHTML = "";
                    tracksSect.style.display = "none";
                    btnPreview.disabled = false; btnApply.disabled = true;
                }
            } catch (e) {
                setStatus("Réponse inattendue.", "error");
                btnPreview.disabled = false;
            }
        });
    });

    // ── Init — auto-analyse si une séquence est déjà ouverte ──────────────────
    if (cs.isLoaded()) {
        evalScript("getSequenceInfo()").then(function (raw) {
            try {
                var d = JSON.parse(raw);
                if (d && !d.error) {
                    setStatus("« " + d.name + " » — Analyse auto...", "working");
                    setTimeout(runPreview, 500);
                } else {
                    setStatus("Ouvrez une séquence dans Premiere Pro", "");
                }
            } catch (e) { setStatus("Ouvrez une séquence dans Premiere Pro", ""); }
        });
    } else {
        setStatus("Ouvrez ce panel dans Premiere Pro", "");
    }

    new ResizeObserver(function () {
        if (audioBuffer) {
            drawWaveform(audioBuffer, silenceSegments);
            drawMinimap(audioBuffer, silenceSegments);
        }
    }).observe(canvas);

}());
