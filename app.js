(() => {
  "use strict";

  const STORAGE_QUIZZES = "kahootinho_quizzes_v1";
  const CHANNEL = "kahootinho_bus_v1";
  const SESSION_KEY = "kahootinho_session_v1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    role: null, // host | player | solo
    quiz: null,
    pin: null,
    players: {}, // id -> { id, nick, score }
    playerId: null,
    nick: null,
    questionIndex: -1,
    answers: {}, // playerId -> answerIndex
    answerTimes: {},
    timer: null,
    timeLeft: 0,
    questionStartedAt: 0,
    editingId: null,
    lastQuizId: null,
    answered: false
  };

  let bus = null;
  try {
    bus = new BroadcastChannel(CHANNEL);
  } catch {
    bus = null;
  }

  /* ---------- helpers ---------- */
  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function makePin() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function loadCustomQuizzes() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_QUIZZES) || "[]");
    } catch {
      return [];
    }
  }

  function saveCustomQuizzes(list) {
    localStorage.setItem(STORAGE_QUIZZES, JSON.stringify(list));
  }

  function getQuizById(id) {
    if (id === window.QUIZ_NATIVO.id) return structuredClone(window.QUIZ_NATIVO);
    const found = loadCustomQuizzes().find((q) => q.id === id);
    return found ? structuredClone(found) : null;
  }

  function broadcast(type, payload = {}) {
    const msg = { type, pin: state.pin, ...payload, ts: Date.now() };
    if (bus) bus.postMessage(msg);
    // fallback same-tab / storage for browsers without BroadcastChannel sync across refresh
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...msg, _n: Math.random() })
      );
    } catch {
      /* ignore */
    }
  }

  function onBusMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (state.pin && msg.pin && msg.pin !== state.pin) return;

    switch (msg.type) {
      case "join":
        if (state.role !== "host") return;
        if (!state.players[msg.playerId]) {
          state.players[msg.playerId] = {
            id: msg.playerId,
            nick: msg.nick,
            score: 0
          };
          renderLobbyPlayers();
          broadcast("lobby", { players: state.players, quizTitle: state.quiz.title });
          toast(`${msg.nick} entrou`);
        }
        break;
      case "lobby":
        if (state.role === "player") {
          state.players = msg.players || {};
        }
        break;
      case "start":
        if (state.role === "player") {
          state.quiz = msg.quiz;
          state.questionIndex = -1;
        }
        break;
      case "question":
        if (state.role === "player") {
          beginPlayerQuestion(msg.index, msg.timeLimit, msg.question);
        }
        break;
      case "answer":
        if (state.role === "host") {
          state.answers[msg.playerId] = msg.answer;
          state.answerTimes[msg.playerId] = msg.elapsed;
          updateHostAnswerCount();
        }
        break;
      case "reveal":
        if (state.role === "player") {
          showPlayerFeedback(msg);
        }
        break;
      case "final":
        if (state.role === "player") {
          showFinal(msg.players);
        }
        break;
      case "end":
        if (state.role === "player") {
          toast("Jogo encerrado pelo apresentador");
          resetToHome();
        }
        break;
      default:
        break;
    }
  }

  if (bus) {
    bus.onmessage = (e) => onBusMessage(e.data);
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== SESSION_KEY || !e.newValue) return;
    try {
      onBusMessage(JSON.parse(e.newValue));
    } catch {
      /* ignore */
    }
  });

  /* ---------- navigation ---------- */
  function resetToHome() {
    clearInterval(state.timer);
    state.role = null;
    state.quiz = null;
    state.pin = null;
    state.players = {};
    state.questionIndex = -1;
    showScreen("screen-home");
  }

  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const map = {
      "go-home": resetToHome,
      "go-create": () => openCreate(),
      "go-library": () => {
        renderLibrary();
        showScreen("screen-library");
      },
      "go-join": () => showScreen("screen-join"),
      "play-native": () => askPlayMode(window.QUIZ_NATIVO.id),
      "host-native": () => startHost(window.QUIZ_NATIVO.id),
      "solo-native": () => startSolo(window.QUIZ_NATIVO.id),
      "end-game": () => {
        if (state.role === "host") broadcast("end");
        resetToHome();
      }
    };
    if (map[action]) map[action]();
  });

  function askPlayMode(quizId) {
    // quick path: open library focus / host by default for classroom feel
    startHost(quizId);
  }

  /* ---------- library ---------- */
  function renderLibrary() {
    const list = $("#custom-quiz-list");
    const empty = $("#library-empty");
    const quizzes = loadCustomQuizzes();
    list.innerHTML = "";
    empty.classList.toggle("hidden", quizzes.length > 0);

    quizzes.forEach((q) => {
      const card = document.createElement("article");
      card.className = "quiz-card";
      card.innerHTML = `
        <div>
          <span class="badge custom">Manual</span>
          <h3></h3>
          <p></p>
        </div>
        <div class="quiz-card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-host>Apresentar</button>
          <button type="button" class="btn btn-secondary btn-sm" data-solo>Solo</button>
          <button type="button" class="btn btn-ghost btn-sm" data-edit>Editar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-del>Excluir</button>
        </div>
      `;
      card.querySelector("h3").textContent = q.title;
      card.querySelector("p").textContent = `${q.questions.length} questões · ${q.timeLimit || 30}s`;
      card.querySelector("[data-host]").onclick = () => startHost(q.id);
      card.querySelector("[data-solo]").onclick = () => startSolo(q.id);
      card.querySelector("[data-edit]").onclick = () => openCreate(q.id);
      card.querySelector("[data-del]").onclick = () => {
        if (!confirm(`Excluir "${q.title}"?`)) return;
        saveCustomQuizzes(loadCustomQuizzes().filter((x) => x.id !== q.id));
        renderLibrary();
      };
      list.appendChild(card);
    });
  }

  /* ---------- create quiz ---------- */
  function openCreate(editId = null) {
    state.editingId = editId;
    const existing = editId ? getQuizById(editId) : null;
    $("#quiz-title").value = existing?.title || "";
    $("#quiz-desc").value = existing?.description || "";
    $("#quiz-time").value = existing?.timeLimit || 30;
    const editor = $("#questions-editor");
    editor.innerHTML = "";
    const qs = existing?.questions?.length
      ? existing.questions
      : [blankQuestion(), blankQuestion()];
    qs.forEach((q) => editor.appendChild(buildQuestionEditor(q)));
    showScreen("screen-create");
  }

  function blankQuestion() {
    return { text: "", answers: ["", "", "", ""], correct: 0 };
  }

  function buildQuestionEditor(data) {
    const wrap = document.createElement("div");
    wrap.className = "q-editor";
    const idx = $$(".q-editor").length + 1;
    wrap.innerHTML = `
      <div class="q-editor-head">
        <strong>Pergunta ${idx}</strong>
        <button type="button" class="q-remove">Remover</button>
      </div>
      <label class="field">
        <span>Enunciado</span>
        <input class="q-text" type="text" maxlength="280" />
      </label>
      <div class="q-answers"></div>
    `;
    wrap.querySelector(".q-text").value = data.text || "";
    const answersBox = wrap.querySelector(".q-answers");
    for (let i = 0; i < 4; i++) {
      const row = document.createElement("label");
      row.className = "answer-edit";
      row.innerHTML = `
        <input type="radio" name="correct-${uid()}" value="${i}" ${data.correct === i ? "checked" : ""} />
        <input type="text" class="a-text" maxlength="160" placeholder="Alternativa ${String.fromCharCode(65 + i)}" />
      `;
      row.querySelector(".a-text").value = data.answers?.[i] || "";
      answersBox.appendChild(row);
    }
    wrap.querySelector(".q-remove").onclick = () => {
      if ($$(".q-editor").length <= 1) {
        toast("Deixe pelo menos uma pergunta");
        return;
      }
      wrap.remove();
      renumberEditors();
    };
    return wrap;
  }

  function renumberEditors() {
    $$(".q-editor").forEach((el, i) => {
      el.querySelector("strong").textContent = `Pergunta ${i + 1}`;
    });
  }

  $("#btn-add-question").onclick = () => {
    $("#questions-editor").appendChild(buildQuestionEditor(blankQuestion()));
    renumberEditors();
  };

  $("#btn-save-quiz").onclick = () => {
    const title = $("#quiz-title").value.trim();
    const description = $("#quiz-desc").value.trim();
    const timeLimit = Math.min(120, Math.max(5, Number($("#quiz-time").value) || 30));
    if (!title) {
      toast("Informe o título do quiz");
      return;
    }

    const questions = [];
    for (const ed of $$(".q-editor")) {
      const text = ed.querySelector(".q-text").value.trim();
      const answers = [...ed.querySelectorAll(".a-text")].map((i) => i.value.trim());
      const radio = ed.querySelector('input[type="radio"]:checked');
      const correct = radio ? Number(radio.value) : 0;
      if (!text || answers.some((a) => !a)) {
        toast("Preencha enunciado e 4 alternativas em todas as perguntas");
        return;
      }
      questions.push({ text, answers, correct });
    }

    if (!questions.length) {
      toast("Adicione ao menos uma pergunta");
      return;
    }

    const list = loadCustomQuizzes();
    if (state.editingId && state.editingId !== window.QUIZ_NATIVO.id) {
      const i = list.findIndex((q) => q.id === state.editingId);
      if (i >= 0) {
        list[i] = { ...list[i], title, description, timeLimit, questions };
      }
    } else {
      list.unshift({
        id: uid(),
        title,
        description,
        timeLimit,
        builtIn: false,
        questions
      });
    }
    saveCustomQuizzes(list);
    toast("Quiz salvo!");
    renderLibrary();
    showScreen("screen-library");
  };

  /* ---------- host flow ---------- */
  function startHost(quizId) {
    const quiz = getQuizById(quizId);
    if (!quiz || !quiz.questions?.length) {
      toast("Quiz inválido");
      return;
    }
    clearInterval(state.timer);
    state.role = "host";
    state.quiz = quiz;
    state.lastQuizId = quizId;
    state.pin = makePin();
    state.players = {};
    state.questionIndex = -1;
    state.answers = {};
    $("#lobby-title").textContent = quiz.title;
    $("#lobby-pin").textContent = state.pin;
    renderLobbyPlayers();
    $("#btn-start-game").disabled = true;
    showScreen("screen-lobby");
    broadcast("lobby", { players: state.players, quizTitle: quiz.title });
  }

  function renderLobbyPlayers() {
    const list = $("#player-list");
    const players = Object.values(state.players);
    $("#player-count").textContent = String(players.length);
    list.innerHTML = players.map((p) => `<li>${escapeHtml(p.nick)}</li>`).join("");
    $("#btn-start-game").disabled = players.length === 0;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  $("#btn-add-local-player").onclick = () => {
    const nick = prompt("Apelido (jogador de teste no lobby):");
    if (!nick || !nick.trim()) return;
    const id = "local-" + uid();
    state.players[id] = { id, nick: nick.trim().slice(0, 16), score: 0, local: true };
    renderLobbyPlayers();
    toast("Para responder de verdade, use outra aba em “Entrar com PIN”");
  };

  $("#btn-start-game").onclick = () => {
    if (!Object.keys(state.players).length) return;
    broadcast("start", { quiz: { ...state.quiz, questions: state.quiz.questions.map((q) => ({ text: q.text, answers: q.answers })) } });
    nextHostQuestion();
  };

  function nextHostQuestion() {
    clearInterval(state.timer);
    state.questionIndex += 1;
    state.answers = {};
    state.answerTimes = {};

    if (state.questionIndex >= state.quiz.questions.length) {
      finishHostGame();
      return;
    }

    const q = state.quiz.questions[state.questionIndex];
    const timeLimit = state.quiz.timeLimit || 30;
    state.timeLeft = timeLimit;
    state.questionStartedAt = Date.now();

    $("#hq-progress").textContent = `${state.questionIndex + 1} / ${state.quiz.questions.length}`;
    $("#hq-text").textContent = q.text;
    $("#hq-timer").textContent = String(timeLimit);
    $("#hq-answers-count").textContent = "0 respostas";
    renderAnswerButtons($("#hq-answers"), q.answers, null, true);
    showScreen("screen-host-question");

    broadcast("question", {
      index: state.questionIndex,
      timeLimit,
      question: { text: q.text, answers: q.answers }
    });

    state.timer = setInterval(() => {
      state.timeLeft -= 1;
      $("#hq-timer").textContent = String(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) {
        clearInterval(state.timer);
        revealHostQuestion();
      }
    }, 1000);
  }

  function updateHostAnswerCount() {
    const n = Object.keys(state.answers).length;
    const total = Object.keys(state.players).length;
    $("#hq-answers-count").textContent = `${n} / ${total} respostas`;
    if (n >= total && total > 0) {
      clearInterval(state.timer);
      revealHostQuestion();
    }
  }

  $("#btn-skip-timer").onclick = () => {
    clearInterval(state.timer);
    revealHostQuestion();
  };

  function scoreFor(elapsedMs, timeLimit) {
    const limit = timeLimit * 1000;
    const ratio = Math.max(0, 1 - elapsedMs / limit);
    return Math.round(500 + 500 * ratio);
  }

  function revealHostQuestion() {
    const q = state.quiz.questions[state.questionIndex];
    const timeLimit = state.quiz.timeLimit || 30;

    Object.entries(state.answers).forEach(([pid, ans]) => {
      if (ans === q.correct) {
        const pts = scoreFor(state.answerTimes[pid] || timeLimit * 1000, timeLimit);
        if (state.players[pid]) state.players[pid].score += pts;
      }
    });

    const ranking = rankedPlayers();
    broadcast("reveal", {
      index: state.questionIndex,
      correct: q.correct,
      answers: state.answers,
      players: state.players,
      ranking
    });

    $("#reveal-text").textContent = q.text;
    $("#reveal-status").textContent = "Resposta correta";
    renderAnswerButtons($("#reveal-answers"), q.answers, q.correct, true);
    renderLeaderboard($("#leaderboard"), ranking.slice(0, 5));
    const isLast = state.questionIndex >= state.quiz.questions.length - 1;
    $("#btn-next-question").textContent = isLast ? "Ver pódio" : "Próxima";
    showScreen("screen-reveal");
  }

  $("#btn-next-question").onclick = () => nextHostQuestion();

  function finishHostGame() {
    const ranking = rankedPlayers();
    broadcast("final", { players: state.players });
    showFinal(state.players);
  }

  function rankedPlayers() {
    return Object.values(state.players).sort((a, b) => b.score - a.score);
  }

  function renderLeaderboard(el, ranking) {
    el.innerHTML = ranking
      .map(
        (p, i) => `
      <div class="lb-row ${i === 0 ? "top" : ""}">
        <span>${i + 1}. ${escapeHtml(p.nick)}</span>
        <span>${p.score} pts</span>
      </div>`
      )
      .join("");
  }

  function showFinal(playersMap) {
    const ranking = Object.values(playersMap || {}).sort((a, b) => b.score - a.score);
    const podium = $("#podium");
    podium.innerHTML = ranking
      .slice(0, 8)
      .map(
        (p, i) =>
          `<li><span>${i + 1}º · ${escapeHtml(p.nick)}</span><span>${p.score}</span></li>`
      )
      .join("");
    if (!ranking.length) {
      podium.innerHTML = "<li><span>Sem jogadores</span><span>0</span></li>";
    }
    showScreen("screen-final");
  }

  $("#btn-replay").onclick = () => {
    if (state.lastQuizId) startHost(state.lastQuizId);
    else resetToHome();
  };

  /* ---------- player flow ---------- */
  $("#btn-join-game").onclick = () => {
    const pin = $("#join-pin").value.trim();
    const nick = $("#join-nick").value.trim().slice(0, 16);
    if (!/^\d{6}$/.test(pin)) {
      toast("PIN deve ter 6 dígitos");
      return;
    }
    if (!nick) {
      toast("Informe um apelido");
      return;
    }
    state.role = "player";
    state.pin = pin;
    state.nick = nick;
    state.playerId = uid();
    state.answered = false;
    $("#waiting-nick").textContent = `Olá, ${nick}!`;
    showScreen("screen-waiting");
    broadcast("join", { playerId: state.playerId, nick });
  };

  function beginPlayerQuestion(index, timeLimit, question) {
    state.questionIndex = index;
    state.answered = false;
    state.timeLeft = timeLimit;
    state.questionStartedAt = Date.now();
    $("#pa-progress").textContent = `${index + 1} / ${(state.quiz?.questions || []).length || "?"}`;
    $("#pa-timer").textContent = String(timeLimit);
    $("#pa-locked").classList.add("hidden");
    const box = $("#pa-answers");
    renderAnswerButtons(box, question.answers, null, false, (i) => {
      if (state.answered) return;
      state.answered = true;
      const elapsed = Date.now() - state.questionStartedAt;
      broadcast("answer", {
        playerId: state.playerId,
        answer: i,
        elapsed
      });
      $$(".answer-btn", box).forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.i) !== i) b.classList.add("dim");
      });
      $("#pa-locked").classList.remove("hidden");
    });
    showScreen("screen-player-answer");
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      state.timeLeft -= 1;
      $("#pa-timer").textContent = String(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) clearInterval(state.timer);
    }, 1000);
  }

  function showPlayerFeedback(msg) {
    clearInterval(state.timer);
    const myAns = msg.answers?.[state.playerId];
    const ok = myAns === msg.correct;
    const me = msg.players?.[state.playerId];
    const rank = (msg.ranking || []).findIndex((p) => p.id === state.playerId) + 1;
    $("#fb-icon").className = `fb-icon ${ok ? "ok" : "bad"}`;
    $("#fb-icon").textContent = ok ? "✓" : "✗";
    $("#fb-title").textContent = myAns == null ? "Sem resposta" : ok ? "Correto!" : "Incorreto";
    $("#fb-points").textContent = me ? `${me.score} pts` : "";
    $("#fb-rank").textContent = rank > 0 ? `Você está em ${rank}º lugar` : "Aguardando…";
    showScreen("screen-player-feedback");
  }

  /* ---------- solo ---------- */
  function startSolo(quizId) {
    const quiz = getQuizById(quizId);
    if (!quiz) {
      toast("Quiz inválido");
      return;
    }
    clearInterval(state.timer);
    state.role = "solo";
    state.quiz = quiz;
    state.lastQuizId = quizId;
    state.questionIndex = -1;
    state.players = { solo: { id: "solo", nick: "Você", score: 0 } };
    nextSoloQuestion();
  }

  function nextSoloQuestion() {
    clearInterval(state.timer);
    state.questionIndex += 1;
    if (state.questionIndex >= state.quiz.questions.length) {
      $("#solo-end-title").textContent = state.quiz.title;
      const total = state.quiz.questions.length;
      const pts = state.players.solo.score;
      $("#solo-end-score").textContent = `${pts} pts · ${total} perguntas`;
      showScreen("screen-solo-end");
      return;
    }

    const q = state.quiz.questions[state.questionIndex];
    const timeLimit = state.quiz.timeLimit || 30;
    state.timeLeft = timeLimit;
    state.questionStartedAt = Date.now();
    state.answered = false;

    $("#solo-progress").textContent = `${state.questionIndex + 1} / ${state.quiz.questions.length}`;
    $("#solo-score").textContent = `${state.players.solo.score} pts`;
    $("#solo-timer").textContent = String(timeLimit);
    $("#solo-text").textContent = q.text;

    renderAnswerButtons($("#solo-answers"), q.answers, null, false, (i) => {
      if (state.answered) return;
      state.answered = true;
      clearInterval(state.timer);
      const elapsed = Date.now() - state.questionStartedAt;
      const ok = i === q.correct;
      if (ok) {
        state.players.solo.score += scoreFor(elapsed, timeLimit);
      }
      $$("#solo-answers .answer-btn").forEach((b) => {
        b.disabled = true;
        const bi = Number(b.dataset.i);
        if (bi === q.correct) b.classList.add("correct");
        else if (bi === i) b.classList.add("wrong");
        else b.classList.add("dim");
      });
      setTimeout(() => nextSoloQuestion(), 1100);
    });

    showScreen("screen-solo");
    state.timer = setInterval(() => {
      state.timeLeft -= 1;
      $("#solo-timer").textContent = String(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) {
        clearInterval(state.timer);
        if (!state.answered) {
          state.answered = true;
          $$("#solo-answers .answer-btn").forEach((b) => {
            b.disabled = true;
            if (Number(b.dataset.i) === q.correct) b.classList.add("correct");
            else b.classList.add("dim");
          });
          setTimeout(() => nextSoloQuestion(), 1100);
        }
      }
    }, 1000);
  }

  $("#btn-solo-again").onclick = () => {
    if (state.lastQuizId) startSolo(state.lastQuizId);
  };

  /* ---------- shared UI ---------- */
  function renderAnswerButtons(container, answers, correctIndex, showText, onPick) {
    container.innerHTML = "";
    answers.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-btn";
      btn.dataset.i = String(i);
      btn.innerHTML = `<span class="shape" aria-hidden="true"></span><span class="label"></span>`;
      btn.querySelector(".label").textContent = showText || onPick ? text : "";
      if (!showText && !onPick) {
        btn.querySelector(".label").textContent = text;
      }
      if (correctIndex != null) {
        btn.disabled = true;
        if (i === correctIndex) btn.classList.add("correct");
        else btn.classList.add("wrong");
      }
      if (onPick) {
        btn.onclick = () => onPick(i);
      } else {
        btn.disabled = true;
      }
      container.appendChild(btn);
    });
  }

  // boot
  showScreen("screen-home");
})();
