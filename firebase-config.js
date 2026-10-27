/**
 * Configuração do app Web (Firebase Console).
 * Valores de client SDK são públicos por design — a proteção real está nas Security Rules.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBnNXMiZlmNK8G_ZnRLCgy7XQE6e3CKv0c",
  authDomain: "aulasexperimento.firebaseapp.com",
  databaseURL: "https://aulasexperimento-default-rtdb.firebaseio.com",
  projectId: "aulasexperimento",
  storageBucket: "aulasexperimento.firebasestorage.app",
  messagingSenderId: "651873192016",
  appId: "1:651873192016:web:79ec28cef0979cbee6e955"
};

export function isFirebaseConfigured() {
  return (
    typeof firebaseConfig.apiKey === "string" &&
    firebaseConfig.apiKey.length > 10 &&
    !firebaseConfig.apiKey.includes("COLE_AQUI") &&
    firebaseConfig.projectId &&
    !String(firebaseConfig.projectId).includes("COLE_AQUI")
  );
}
