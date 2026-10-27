import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let readyPromise = null;

export function getDb() {
  return db;
}

export function getFirebaseAuth() {
  return auth;
}

export function firebaseReady() {
  return readyPromise;
}

export async function initFirebase() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (!isFirebaseConfigured()) {
      throw new Error(
        "Firebase não configurado. Edite firebase-config.js com os dados do seu projeto."
      );
    }
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        // permite nova tentativa depois de ativar Anonymous no Console
        readyPromise = null;
        throw err;
      }
    }

    return { app, auth, db };
  })();

  return readyPromise;
}
