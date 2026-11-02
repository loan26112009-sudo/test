/**
 * AutoCut Silence - Logique principale du panel
 */

(function () {
    "use strict";

    // ─── État global ────────────────────────────────────────────────────────
    var cs = new CSInterface();
    var audioBuffer = null;
    var silenceSegments = [];
    var sequenceInfo = null;
    var clipsList = [];
    var isAnalyzing = false;
    var isApplying = false;

    // ─── Paramètres ─────────────────────────────────────────────────────────
    var params = {
        thresholdDb: -35,       // Seuil de détection (dB)
        minSilenceMs: 300,      // Durée min silence (ms)
        paddingBeforeMs: 50,    // Padding avant la coupe (ms)
        paddingAfterMs: 50,     // Padding après la coupe (ms)
        numVideoTracks: 2,      // Nb pistes vidéo à couper
        addMarkers: true        // Ajouter des marqueurs de preview
    };

    // ─── Refs DOM ────────────────────────────────────────────────────────────
    var els = {
        thresholdSlider:   document.getElementById("threshold-slider"),
        thresholdInput:    document.getElementById("threshold-input"),
        minSilenceSlider:  document.getElementById("min-silence-slider"),
        minSilenceInput:   document.getElementById("min-silence-input"),
        paddingBefore:     document.getElementById("padding-before"),
        paddingAfter:      document.getElementById("padding-after"),
        trackBtns:         document.querySelectorAll(".track-btn"),
        addMarkers:        document.getElementById("add-markers"),
        statusDot:         document.getElementById("status-dot"),
        statusText:        document.getElementById("status-text"),
        waveformCanvas:    document.getElementById("waveform-canvas"),
        waveformPlaceholder: document.getElementById("waveform-placeholder"),
        silenceStats:      document.getElementById("silence-stats"),
        progressWrap:      document.getElementById("progress-bar-wrap"),
        progressBar:       document.getElementById("progress-bar"),
        btnPreview:        document.getElementById("btn-preview"),
        btnApply:          document.getElementById("btn-apply"),
        toast:             document.getElementById("toast")
    };

    // ─── Utilitaires ────────────────────────────────────────────────────────

    function setStatus(text, type) {
        // type: "", "ok", "error", "working"
        els.statusText.textContent = text;
        els.statusDot.className = "status-dot " + (type || "");
    }

    function showToast(msg, type, duration) {
        els.toast.textContent = msg;
        els.toast.className = "show " + (type || "");
        clearTimeout(els.toast._tid);
        els.toast._tid = setTimeout(function () {
            els.toast.className = "";
        }, duration || 3000);
    }

    function setProgress(pct) {
        if (pct <= 0) {
            els.progressWrap.style.display = "none";
            els.progressBar.style.width = "0%";
        } else {
            els.progressWrap.style.display = "block";
            els.progressBar.style.width = Math.min(100, pct) + "%";
        }
    }

    function formatSeconds(s) {
        var m = Math.floor(s / 60);
        var sec = (s % 60).toFixed(1);
        return m > 0 ? m + "m " + sec + "s" : sec + "s";
    }

    function setButtonsDisabled(disabled) {
        els.btnPreview.disabled = disabled;
        els.btnApply.disabled = disabled || silenceSegments.length === 0;
    }

    // ─── Liaison des paramètres ──────────────────────────────────────────────

    function bindSliderInput(slider, input, key, min, max) {
        slider.addEventListener("input", function () {
            var v = parseFloat(slider.value);
            params[key] = v;
            input.value = v;
            onParamChange();
        });
        input.addEventListener("change", function () {
            var v = Math.min(max, Math.max(min, parseFloat(input.value) || min));
            params[key] = v;
            slider.value = v;
            input.value = v;
            onParamChange();
        });
    }

    function bindInput(input, key, min, max) {
        input.addEventListener("change", function () {
            var v = Math.min(max, Math.max(min, parseFloat(input.value) || min));
            params[key] = v;
            input.value = v;
            onParamChange();
        });
    }

    function onParamChange() {
        // Si on a déjà un audioBuffer, re-analyser et re-dessiner en direct
        if (audioBuffer) {
            runAnalysis(false);
        }
    }

    function initControls() {
        bindSliderInput(els.thresholdSlider, els.thresholdInput, "thresholdDb", -80, 0);
        bindSliderInput(els.minSilenceSlider, els.minSilenceInput, "minSilenceMs", 50, 3000);
        bindInput(els.paddingBefore, "paddingBeforeMs", 0, 500);
        bindInput(els.paddingAfter, "paddingAfterMs", 0, 500);

        // Track selector — valeur par défaut = 2
        params.numVideoTracks = 2;
        els.trackBtns.forEach(function (btn) {
            if (parseInt(btn.dataset.value, 10) === 2) btn.classList.add("active");
            else btn.classList.remove("active");

            btn.addEventListener("click", function () {
                els.trackBtns.forEach(function (b) { b.classList.remove("active"); });
                btn.classList.add("active");
                params.numVideoTracks = parseInt(btn.dataset.value, 10) || 99;
            });
        });

        // Toggle marqueurs
        els.addMarkers.addEventListener("change", function () {
            params.addMarkers = els.addMarkers.checked;
        });

        // Initialise les valeurs par défaut dans l'UI
        els.thresholdSlider.value = params.thresholdDb;
        els.thresholdInput.value = params.thresholdDb;
        els.minSilenceSlider.value = params.minSilenceMs;
        els.minSilenceInput.value = params.minSilenceMs;
        els.paddingBefore.value = params.paddingBeforeMs;
        els.paddingAfter.value = params.paddingAfterMs;
    }

    // ─── Communication avec Premiere Pro ─────────────────────────────────────

    function evalScript(script) {
        return new Promise(function (resolve) {
            cs.evalScript(script, function (result) {
                resolve(result);
            });
        });
    }

    function loadSequenceInfo() {
        return evalScript("getSequenceInfo()").then(function (raw) {
            try {
                var data = JSON.parse(raw);
                if (data.error) {
                    setStatus(data.error, "error");
                    return null;
                }
                sequenceInfo = data;
                return data;
            } catch (e) {
                setStatus("Erreur communication Premiere Pro", "error");
                return null;
            }
        });
    }

    function loadClipsInfo() {
        return evalScript("getClipsInfo()").then(function (raw) {
            try {
                var data = JSON.parse(raw);
                if (data.error) {
                    setStatus(data.error, "error");
                    return null;
                }
                clipsList = data.audioClips || [];
                return clipsList;
            } catch (e) {
                return null;
            }
        });
    }

    // ─── Lecture audio (Node.js + Web Audio API) ─────────────────────────────

    function readFileBuffer(filePath) {
        return new Promise(function (resolve, reject) {
            // Essaie d'utiliser le module fs de Node.js (disponible dans CEP)
            var fs = null;
            try { fs = require("fs"); } catch (e1) {
                try { fs = window.require("fs"); } catch (e2) { fs = null; }
            }

            if (fs) {
                try {
                    var buf = fs.readFileSync(filePath);
                    // Convertit Buffer Node en ArrayBuffer
                    var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    resolve(ab);
                } catch (e) {
                    reject(new Error("Impossible de lire le fichier : " + e.message));
                }
            } else {
                // Fallback : fetch avec file://
                var uri = "file:///" + filePath.replace(/\\/g, "/").replace(/^\//, "");
                fetch(uri)
                    .then(function (r) { return r.arrayBuffer(); })
                    .then(resolve)
                    .catch(function () { reject(new Error("Impossible d'accéder au fichier source.")); });
            }
        });
    }

    function decodeAudio(arrayBuffer) {
        return new Promise(function (resolve, reject) {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
        });
    }

    // ─── Analyse des silences ────────────────────────────────────────────────

    function detectSilences(buffer, thresholdDb, minSilenceMs, paddingBeforeMs, paddingAfterMs, srcStart, seqStart) {
        var sampleRate   = buffer.sampleRate;
        var thresholdLin = Math.pow(10, thresholdDb / 20);
        var minSamples   = Math.floor(minSilenceMs / 1000 * sampleRate);
        var padBeforeSmp = Math.floor(paddingBeforeMs / 1000 * sampleRate);
        var padAfterSmp  = Math.floor(paddingAfterMs / 1000 * sampleRate);

        // Fusionne les canaux (RMS sur tous les canaux)
        var numCh    = buffer.numberOfChannels;
        var numSmpl  = buffer.length;
        var channels = [];
        for (var c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

        // Analyse par fenêtres de 10ms
        var windowSamples = Math.max(1, Math.floor(sampleRate * 0.01));
        var silences = [];
        var silStart = -1;

        for (var i = 0; i < numSmpl; i += windowSamples) {
            var end = Math.min(i + windowSamples, numSmpl);
            var sumSq = 0;
            for (var j = i; j < end; j++) {
                var sample = 0;
                for (var ch = 0; ch < numCh; ch++) sample += channels[ch][j];
                sample /= numCh;
                sumSq += sample * sample;
            }
            var rms = Math.sqrt(sumSq / (end - i));

            if (rms < thresholdLin) {
                if (silStart === -1) silStart = i;
            } else {
                if (silStart !== -1) {
                    var silLen = i - silStart;
                    if (silLen >= minSamples) {
                        var s = Math.max(0, silStart + padBeforeSmp);
                        var e = Math.max(s + windowSamples, i - padAfterSmp);
                        silences.push({ srcStart: s, srcEnd: e });
                    }
                    silStart = -1;
                }
            }
        }
        // Vérifie fin de fichier
        if (silStart !== -1) {
            var silLen = numSmpl - silStart;
            if (silLen >= minSamples) {
                var s = Math.max(0, silStart + padBeforeSmp);
                var e = Math.max(s + windowSamples, numSmpl - padAfterSmp);
                silences.push({ srcStart: s, srcEnd: e });
            }
        }

        // Convertit les positions samples en secondes dans la SÉQUENCE
        var offset = seqStart - srcStart; // décalage clip_src -> timeline
        return silences.map(function (sil) {
            return {
                start: sil.srcStart / sampleRate + srcStart + offset,
                end:   sil.srcEnd   / sampleRate + srcStart + offset,
                // Garde aussi les positions en samples pour le rendu du waveform
                _s: sil.srcStart,
                _e: sil.srcEnd
            };
        });
    }

    // ─── Waveform ────────────────────────────────────────────────────────────

    function drawWaveform(buffer, silences) {
        var canvas = els.waveformCanvas;
        var ctx    = canvas.getContext("2d");
        var W      = canvas.offsetWidth;
        var H      = canvas.offsetHeight;
        canvas.width  = W;
        canvas.height = H;

        ctx.clearRect(0, 0, W, H);

        // Fond
        ctx.fillStyle = "#1e1e32";
        ctx.fillRect(0, 0, W, H);

        if (!buffer) return;

        var data      = buffer.getChannelData(0);
        var numSmpl   = buffer.length;
        var mid       = H / 2;
        var blockSize = Math.max(1, Math.floor(numSmpl / W));

        // Marque les zones de silence en arrière-plan
        ctx.fillStyle = "rgba(239,68,68,0.18)";
        silences.forEach(function (sil) {
            var xStart = Math.floor((sil._s / numSmpl) * W);
            var xEnd   = Math.ceil((sil._e  / numSmpl) * W);
            ctx.fillRect(xStart, 0, Math.max(1, xEnd - xStart), H);
        });

        // Ligne centrale
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(W, mid);
        ctx.stroke();

        // Waveform
        ctx.beginPath();
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth   = 1;

        for (var x = 0; x < W; x++) {
            var from = x * blockSize;
            var to   = Math.min(from + blockSize, numSmpl);
            var min  = 0, max = 0;
            for (var j = from; j < to; j++) {
                if (data[j] < min) min = data[j];
                if (data[j] > max) max = data[j];
            }
            ctx.moveTo(x + 0.5, mid + min * mid * 0.9);
            ctx.lineTo(x + 0.5, mid + max * mid * 0.9);
        }
        ctx.stroke();

        // Bordures des silences
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        silences.forEach(function (sil) {
            var xStart = Math.floor((sil._s / numSmpl) * W);
            var xEnd   = Math.ceil((sil._e  / numSmpl) * W);
            ctx.beginPath();
            ctx.moveTo(xStart + 0.5, 0);
            ctx.lineTo(xStart + 0.5, H);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(xEnd - 0.5, 0);
            ctx.lineTo(xEnd - 0.5, H);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        els.waveformPlaceholder.style.display = "none";
    }

    // ─── Stats silences ───────────────────────────────────────────────────────

    function updateStats(silences, totalDuration) {
        var container = els.silenceStats;
        container.innerHTML = "";

        var totalSilence = silences.reduce(function (sum, s) { return sum + (s.end - s.start); }, 0);
        var pct = totalDuration > 0 ? Math.round((totalSilence / totalDuration) * 100) : 0;

        var chips = [
            { label: silences.length + " silence" + (silences.length > 1 ? "s" : ""), cls: silences.length > 0 ? "red" : "" },
            { label: formatSeconds(totalSilence) + " à couper", cls: totalSilence > 0 ? "red" : "" },
            { label: pct + "% du clip", cls: pct > 0 ? "highlight" : "" }
        ];

        chips.forEach(function (c) {
            var chip = document.createElement("span");
            chip.className = "stat-chip " + (c.cls || "");
            chip.textContent = c.label;
            container.appendChild(chip);
        });
    }

    // ─── Flux principal ───────────────────────────────────────────────────────

    function runAnalysis(withFileLoad) {
        withFileLoad = (withFileLoad !== false);

        if (withFileLoad) {
            // Charge depuis Premiere Pro
            setStatus("Connexion à Premiere Pro...", "working");
            setProgress(5);
            setButtonsDisabled(true);
            silenceSegments = [];
            audioBuffer     = null;
            els.waveformPlaceholder.style.display = "flex";

            loadSequenceInfo()
                .then(function (seq) {
                    if (!seq) { setProgress(0); setButtonsDisabled(false); return; }
                    setStatus("Récupération des clips...", "working");
                    setProgress(15);
                    return loadClipsInfo();
                })
                .then(function (clips) {
                    if (!clips || clips.length === 0) {
                        setStatus("Aucun clip audio trouvé dans la séquence.", "error");
                        setProgress(0);
                        setButtonsDisabled(false);
                        return;
                    }

                    var clip = clips[0];
                    if (!clip.filePath) {
                        setStatus("Chemin du fichier source introuvable.", "error");
                        setProgress(0);
                        setButtonsDisabled(false);
                        return;
                    }

                    setStatus("Lecture du fichier audio...", "working");
                    setProgress(30);

                    readFileBuffer(clip.filePath).then(function (ab) {
                        setStatus("Décodage audio...", "working");
                        setProgress(55);

                        decodeAudio(ab).then(function (buf) {
                            audioBuffer = buf;
                            setProgress(70);
                            runAnalysis(false); // analyse sans re-charger le fichier
                        }).catch(function (e) {
                            setStatus("Impossible de décoder l'audio : " + (e.message || e), "error");
                            showToast("Format audio non supporté. Essayez un MP4/WAV.", "error");
                            setProgress(0);
                            setButtonsDisabled(false);
                        });
                    }).catch(function (e) {
                        setStatus(e.message, "error");
                        setProgress(0);
                        setButtonsDisabled(false);
                    });
                });
        } else {
            // Re-analyse avec les paramètres actuels (audioBuffer déjà chargé)
            if (!audioBuffer) return;

            setStatus("Analyse des silences...", "working");
            setProgress(80);

            var clip = clipsList[0] || { srcStart: 0, seqStart: 0 };

            // Lance en setTimeout pour ne pas bloquer l'UI
            setTimeout(function () {
                silenceSegments = detectSilences(
                    audioBuffer,
                    params.thresholdDb,
                    params.minSilenceMs,
                    params.paddingBeforeMs,
                    params.paddingAfterMs,
                    clip.srcStart || 0,
                    clip.seqStart || 0
                );

                drawWaveform(audioBuffer, silenceSegments);
                updateStats(silenceSegments, audioBuffer.duration);

                var msg = silenceSegments.length === 0
                    ? "Aucun silence détecté — essayez d'ajuster le seuil."
                    : silenceSegments.length + " silence(s) détecté(s). Prêt à appliquer.";

                setStatus(msg, silenceSegments.length > 0 ? "ok" : "");
                setProgress(0);
                setButtonsDisabled(false);
                els.btnApply.disabled = silenceSegments.length === 0;

                if (params.addMarkers && silenceSegments.length > 0 && cs.isLoaded()) {
                    var json = JSON.stringify(silenceSegments.map(function (s) {
                        return { start: s.start, end: s.end };
                    }));
                    evalScript("createPreviewMarkers('" + json.replace(/'/g, "\\'") + "')");
                }
            }, 0);
        }
    }

    function applyToSequence() {
        if (silenceSegments.length === 0) {
            showToast("Générez d'abord un aperçu.", "error");
            return;
        }
        if (!cs.isLoaded()) {
            showToast("Non connecté à Premiere Pro.", "error");
            return;
        }

        isApplying = true;
        setButtonsDisabled(true);
        setStatus("Application des coupes en cours...", "working");
        setProgress(10);

        var seqSilences = silenceSegments.map(function (s) {
            return { start: s.start, end: s.end };
        });

        // Trie en ordre décroissant (requis pour le ripple delete)
        seqSilences.sort(function (a, b) { return b.start - a.start; });

        var json = JSON.stringify(seqSilences);
        // Échappe les apostrophes pour l'injection dans evalScript
        json = json.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

        evalScript("applySilenceCuts('" + json + "', " + params.numVideoTracks + ")").then(function (raw) {
            isApplying = false;
            setProgress(0);
            try {
                var result = JSON.parse(raw);
                if (result.error) {
                    setStatus("Erreur : " + result.error, "error");
                    showToast(result.error, "error");
                } else {
                    setStatus(result.cuts + " coupe(s) appliquée(s) avec succès !", "ok");
                    showToast("✓ " + result.cuts + " silence(s) supprimé(s)", "success");
                    // Réinitialise pour une nouvelle analyse
                    silenceSegments = [];
                    audioBuffer     = null;
                    els.waveformPlaceholder.style.display = "flex";
                    drawWaveform(null, []);
                    els.silenceStats.innerHTML = "";
                    els.btnApply.disabled = true;
                }
            } catch (e) {
                setStatus("Réponse inattendue.", "error");
            }
            setButtonsDisabled(false);
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    function init() {
        initControls();

        // Vérifie la connexion à Premiere Pro au démarrage
        if (cs.isLoaded()) {
            loadSequenceInfo().then(function (seq) {
                if (seq) {
                    setStatus("Séquence « " + seq.name + " » — Cliquez Générer Aperçu", "ok");
                } else {
                    setStatus("Ouvrez une séquence dans Premiere Pro", "");
                }
            });
        } else {
            setStatus("Ouvrez ce panel dans Premiere Pro", "");
        }

        els.btnPreview.addEventListener("click", function () {
            if (!isAnalyzing) runAnalysis(true);
        });

        els.btnApply.addEventListener("click", function () {
            if (!isApplying) applyToSequence();
        });

        // Resize du canvas waveform
        var resizeObserver = new ResizeObserver(function () {
            if (audioBuffer) drawWaveform(audioBuffer, silenceSegments);
        });
        resizeObserver.observe(els.waveformCanvas);
    }

    document.addEventListener("DOMContentLoaded", init);

})();
