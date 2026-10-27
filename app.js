import { initFirebase, getDb, getFirebaseAuth } from "./firebase.js";
import { isFirebaseConfigured } from "./firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

(() => {
  "use strict";

  const STORAGE_QUIZZES = "kahootinho_quizzes_v1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    role: null,
    quiz: null,
    pin: null,
    players: {},
    playerId: null,
    nick: null,
    questionIndex: -1,
    answers: {},
    answerTimes: {},
    timer: null,
    timeLeft: 0,
    questionStartedAt: 0,
    editingId: null,
    lastQuizId: null,
    answered: false,
    unsubRoom: null,
    unsubPlayers: null,
    unsubAnswers: null,
    lastRoomStatus: null,
    lastQuestionIndex: null,
    revealing: false
  };

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
    toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function makePin() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function roomRef(pin) {
    return doc(getDb(), "rooms", pin);
  }

  function playersCol(pin) {
    return collection(getDb(), "rooms", pin, "players");
  }

  function answersCol(pin) {
    return collection(getDb(), "rooms", pin, "answers");
  }

  function clearListeners() {
    if (state.unsubRoom) state.unsubRoom();
    if (state.unsubPlayers) state.unsubPlayers();
    if (state.unsubAnswers) state.unsubAnswers();
    state.unsubRoom = null;
    state.unsubPlayers = null;
    state.unsubAnswers = null;
  }

  async function ensureFirebase() {
    if (!isFirebaseConfigured()) {
      toast("Configure o Firebase em firebase-config.js");
      throw new Error("Firebase não configurado");
    }
    await initFirebase();
    state.playerId = getFirebaseAuth().currentUser.uid;
  }

  function scoreFor(elapsedMs, timeLimit) {
    const limit = timeLimit * 1000;
    const ratio = Math.max(0, 1 - elapsedMs / limit);
    return Math.round(500 + 500 * ratio);
  }

  function rankedPlayers() {
    return Object.values(state.players).sort((a, b) => b.score - a.score);
  }

  /* ---------- navigation ---------- */
  async function resetToHome() {
    clearInterval(state.timer);
    if (state.role === "host" && state.pin) {
      try {
        await updateDoc(roomRef(state.pin), { status: "ended" });
      } catch {
        /* ignore */
      }
    }
    clearListeners();
    state.role = null;
    state.quiz = null;
    state.pin = null;
    state.players = {};
    state.questionIndex = -1;
    state.lastRoomStatus = null;
    state.lastQuestionIndex = null;
    state.revealing = false;
    showScreen("screen-home");
  }

  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const map = {
      "go-home": () => {
        resetToHome();
      },
      "go-create": () => openCreate(),
      "go-library": () => {
        renderLibrary();
        showScreen("screen-library");
      },
      "go-join": () => showScreen("screen-join"),
      "play-native": () => startHost(window.QUIZ_NATIVO.id),
      "host-native": () => startHost(window.QUIZ_NATIVO.id),
      "solo-native": () => startSolo(window.QUIZ_NATIVO.id),
      "end-game": () => {
        resetToHome();
      }
    };
    if (map[action]) map[action]();
  });

  /* ---------- library / create (local) ---------- */
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
    wrap.innerHTML = `
      <div class="q-editor-head">
        <strong>Pergunta</strong>
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

  /* ---------- host (Firestore) ---------- */
  async function startHost(quizId) {
    const quiz = getQuizById(quizId);
    if (!quiz || !quiz.questions?.length) {
      toast("Quiz inválido");
      return;
    }

    try {
      await ensureFirebase();
    } catch {
      return;
    }

    clearInterval(state.timer);
    clearListeners();

    let pin = makePin();
    for (let i = 0; i < 5; i++) {
      const existing = await getDoc(roomRef(pin));
      if (!existing.exists()) break;
      pin = makePin();
    }

    const hostUid = getFirebaseAuth().currentUser.uid;
    state.role = "host";
    state.quiz = quiz;
    state.lastQuizId = quizId;
    state.pin = pin;
    state.players = {};
    state.questionIndex = -1;
    state.answers = {};
    state.revealing = false;
    state.lastRoomStatus = "lobby";
    state.lastQuestionIndex = null;

    await setDoc(roomRef(pin), {
      hostUid,
      title: quiz.title,
      status: "lobby",
      questionIndex: -1,
      questionTotal: quiz.questions.length,
      timeLimit: quiz.timeLimit || 30,
      questionStartedAt: null,
      currentQuestion: null,
      correctIndex: null,
      createdAt: serverTimestamp()
    });

    $("#lobby-title").textContent = quiz.title;
    $("#lobby-pin").textContent = pin;
    renderLobbyPlayers();
    $("#btn-start-game").disabled = true;
    showScreen("screen-lobby");

    state.unsubPlayers = onSnapshot(playersCol(pin), (snap) => {
      const next = {};
      snap.forEach((d) => {
        next[d.id] = { id: d.id, ...d.data() };
      });
      const prevCount = Object.keys(state.players).length;
      state.players = next;
      renderLobbyPlayers();
      if (Object.keys(next).length > prevCount && state.lastRoomStatus === "lobby") {
        const newest = Object.values(next).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0))[0];
        if (newest) toast(`${newest.nick} entrou`);
      }
    });
  }

  function renderLobbyPlayers() {
    const list = $("#player-list");
    const players = Object.values(state.players);
    $("#player-count").textContent = String(players.length);
    list.innerHTML = players.map((p) => `<li>${escapeHtml(p.nick)}</li>`).join("");
    $("#btn-start-game").disabled = players.length === 0;
  }

  $("#btn-start-game").onclick = async () => {
    if (!Object.keys(state.players).length) return;
    $("#btn-start-game").disabled = true;
    try {
      await nextHostQuestion();
    } catch (err) {
      console.error(err);
      toast("Não foi possível iniciar");
      $("#btn-start-game").disabled = false;
    }
  };

  async function clearAnswers(pin) {
    const snap = await getDocs(answersCol(pin));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  async function nextHostQuestion() {
    clearInterval(state.timer);
    state.revealing = false;
    state.questionIndex += 1;
    state.answers = {};
    state.answerTimes = {};

    if (state.questionIndex >= state.quiz.questions.length) {
      await finishHostGame();
      return;
    }

    const q = state.quiz.questions[state.questionIndex];
    const timeLimit = state.quiz.timeLimit || 30;
    state.timeLeft = timeLimit;
    state.questionStartedAt = Date.now();
    state.lastRoomStatus = "question";
    state.lastQuestionIndex = state.questionIndex;

    await clearAnswers(state.pin);
    await updateDoc(roomRef(state.pin), {
      status: "question",
      questionIndex: state.questionIndex,
      timeLimit,
      questionStartedAt: state.questionStartedAt,
      currentQuestion: { text: q.text, answers: q.answers },
      correctIndex: null
    });

    $("#hq-progress").textContent = `${state.questionIndex + 1} / ${state.quiz.questions.length}`;
    $("#hq-text").textContent = q.text;
    $("#hq-timer").textContent = String(timeLimit);
    $("#hq-answers-count").textContent = "0 respostas";
    renderAnswerButtons($("#hq-answers"), q.answers, null, true);
    showScreen("screen-host-question");

    if (state.unsubAnswers) state.unsubAnswers();
    state.unsubAnswers = onSnapshot(answersCol(state.pin), (snap) => {
      const answers = {};
      const times = {};
      snap.forEach((d) => {
        const data = d.data();
        if (data.questionIndex !== state.questionIndex) return;
        answers[d.id] = data.answer;
        times[d.id] = data.elapsed;
      });
      state.answers = answers;
      state.answerTimes = times;
      updateHostAnswerCount();
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
    if (n >= total && total > 0 && !state.revealing) {
      clearInterval(state.timer);
      revealHostQuestion();
    }
  }

  $("#btn-skip-timer").onclick = () => {
    clearInterval(state.timer);
    revealHostQuestion();
  };

  async function revealHostQuestion() {
    if (state.revealing) return;
    state.revealing = true;
    clearInterval(state.timer);

    const q = state.quiz.questions[state.questionIndex];
    const timeLimit = state.quiz.timeLimit || 30;

    const scoreUpdates = [];
    Object.entries(state.answers).forEach(([pid, ans]) => {
      if (ans === q.correct && state.players[pid]) {
        const pts = scoreFor(state.answerTimes[pid] || timeLimit * 1000, timeLimit);
        state.players[pid].score += pts;
        scoreUpdates.push(
          updateDoc(doc(getDb(), "rooms", state.pin, "players", pid), {
            score: state.players[pid].score
          })
        );
      }
    });
    await Promise.all(scoreUpdates);

    await updateDoc(roomRef(state.pin), {
      status: "reveal",
      correctIndex: q.correct
    });
    state.lastRoomStatus = "reveal";

    const ranking = rankedPlayers();
    $("#reveal-text").textContent = q.text;
    $("#reveal-status").textContent = "Resposta correta";
    renderAnswerButtons($("#reveal-answers"), q.answers, q.correct, true);
    renderLeaderboard($("#leaderboard"), ranking.slice(0, 5));
    const isLast = state.questionIndex >= state.quiz.questions.length - 1;
    $("#btn-next-question").textContent = isLast ? "Ver pódio" : "Próxima";
    showScreen("screen-reveal");
  }

  $("#btn-next-question").onclick = () => {
    nextHostQuestion().catch((err) => {
      console.error(err);
      toast("Erro ao avançar");
    });
  };

  async function finishHostGame() {
    await updateDoc(roomRef(state.pin), {
      status: "final",
      currentQuestion: null,
      correctIndex: null
    });
    state.lastRoomStatus = "final";
    showFinal(state.players);
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

  /* ---------- player (Firestore) ---------- */
  $("#btn-join-game").onclick = async () => {
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

    try {
      await ensureFirebase();
    } catch {
      return;
    }

    const roomSnap = await getDoc(roomRef(pin));
    if (!roomSnap.exists()) {
      toast("Sala não encontrada. Confira o PIN.");
      return;
    }
    const room = roomSnap.data();
    if (room.status !== "lobby") {
      toast("Este jogo já começou ou terminou");
      return;
    }

    clearListeners();
    state.role = "player";
    state.pin = pin;
    state.nick = nick;
    state.playerId = getFirebaseAuth().currentUser.uid;
    state.answered = false;
    state.quiz = {
      title: room.title,
      timeLimit: room.timeLimit,
      questions: Array(room.questionTotal).fill(null)
    };
    state.lastRoomStatus = "lobby";
    state.lastQuestionIndex = null;

    await setDoc(doc(getDb(), "rooms", pin, "players", state.playerId), {
      nick,
      score: 0,
      joinedAt: Date.now()
    });

    $("#waiting-nick").textContent = `Olá, ${nick}!`;
    showScreen("screen-waiting");

    state.unsubPlayers = onSnapshot(playersCol(pin), (snap) => {
      const next = {};
      snap.forEach((d) => {
        next[d.id] = { id: d.id, ...d.data() };
      });
      state.players = next;
    });

    state.unsubRoom = onSnapshot(roomRef(pin), (snap) => {
      if (!snap.exists()) {
        toast("Sala encerrada");
        resetToHome();
        return;
      }
      handlePlayerRoomUpdate(snap.data());
    });
  };

  function handlePlayerRoomUpdate(room) {
    if (room.status === "ended") {
      toast("Jogo encerrado pelo apresentador");
      resetToHome();
      return;
    }

    if (room.status === "question") {
      const changed =
        state.lastRoomStatus !== "question" ||
        state.lastQuestionIndex !== room.questionIndex;
      state.lastRoomStatus = "question";
      state.lastQuestionIndex = room.questionIndex;
      if (changed && room.currentQuestion) {
        beginPlayerQuestion(
          room.questionIndex,
          room.timeLimit || 30,
          room.currentQuestion,
          room.questionStartedAt,
          room.questionTotal
        );
      }
      return;
    }

    if (room.status === "reveal") {
      if (state.lastRoomStatus !== "reveal" || state.lastQuestionIndex !== room.questionIndex) {
        state.lastRoomStatus = "reveal";
        state.lastQuestionIndex = room.questionIndex;
        showPlayerFeedbackFromRoom(room);
      }
      return;
    }

    if (room.status === "final") {
      state.lastRoomStatus = "final";
      showFinal(state.players);
    }
  }

  function beginPlayerQuestion(index, timeLimit, question, startedAt, total) {
    state.questionIndex = index;
    state.answered = false;
    const elapsedAlready = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    state.timeLeft = Math.max(0, Math.ceil((timeLimit * 1000 - elapsedAlready) / 1000));
    state.questionStartedAt = startedAt || Date.now();

    $("#pa-progress").textContent = `${index + 1} / ${total || "?"}`;
    $("#pa-timer").textContent = String(state.timeLeft);
    $("#pa-locked").classList.add("hidden");

    const box = $("#pa-answers");
    renderAnswerButtons(box, question.answers, null, false, async (i) => {
      if (state.answered) return;
      state.answered = true;
      const elapsed = Date.now() - state.questionStartedAt;
      try {
        await setDoc(doc(getDb(), "rooms", state.pin, "answers", state.playerId), {
          questionIndex: index,
          answer: i,
          elapsed,
          at: Date.now()
        });
      } catch (err) {
        console.error(err);
        state.answered = false;
        toast("Falha ao enviar resposta");
        return;
      }
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

  async function showPlayerFeedbackFromRoom(room) {
    clearInterval(state.timer);
    let myAns = null;
    try {
      const ansSnap = await getDoc(doc(getDb(), "rooms", state.pin, "answers", state.playerId));
      if (ansSnap.exists() && ansSnap.data().questionIndex === room.questionIndex) {
        myAns = ansSnap.data().answer;
      }
    } catch {
      /* ignore */
    }

    const ok = myAns != null && myAns === room.correctIndex;
    const me = state.players[state.playerId];
    const ranking = rankedPlayers();
    const rank = ranking.findIndex((p) => p.id === state.playerId) + 1;

    $("#fb-icon").className = `fb-icon ${ok ? "ok" : "bad"}`;
    $("#fb-icon").textContent = ok ? "✓" : "✗";
    $("#fb-title").textContent = myAns == null ? "Sem resposta" : ok ? "Correto!" : "Incorreto";
    $("#fb-points").textContent = me ? `${me.score} pts` : "";
    $("#fb-rank").textContent = rank > 0 ? `Você está em ${rank}º lugar` : "Aguardando…";
    showScreen("screen-player-feedback");
  }

  /* ---------- solo (offline) ---------- */
  function startSolo(quizId) {
    const quiz = getQuizById(quizId);
    if (!quiz) {
      toast("Quiz inválido");
      return;
    }
    clearInterval(state.timer);
    clearListeners();
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
      if (ok) state.players.solo.score += scoreFor(elapsed, timeLimit);
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

  function renderAnswerButtons(container, answers, correctIndex, showText, onPick) {
    container.innerHTML = "";
    answers.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-btn";
      btn.dataset.i = String(i);
      btn.innerHTML = `<span class="shape" aria-hidden="true"></span><span class="label"></span>`;
      btn.querySelector(".label").textContent = showText || onPick ? text : text;
      if (correctIndex != null) {
        btn.disabled = true;
        if (i === correctIndex) btn.classList.add("correct");
        else btn.classList.add("wrong");
      }
      if (onPick) btn.onclick = () => onPick(i);
      else btn.disabled = true;
      container.appendChild(btn);
    });
  }

  // boot
  showScreen("screen-home");
  if (!isFirebaseConfigured()) {
    setTimeout(() => {
      toast("Falta configurar o Firebase (firebase-config.js)");
    }, 600);
  }
})();
