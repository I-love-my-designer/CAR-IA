NE PAS AVOIR DE SCROLL DANS TOUTE LA PWA.
Ne récapitule jamais les questions précédentes, réponds uniquement de manière brève à la dernière ligne.
DANS LE "firebase-applet-config.json" : NE CHANGE JAMAIS LES PARAMETRES SUIVANTS SAUF SI TU ME LE DEMANDE ET QUE JE TE REPONDS DE LE FAIRE :
{
  "projectId": "gen-lang-client-0870404092",
  "appId": "1:172885729212:web:ab072eb63a25c3af0c95b9",
  "apiKey": "AIzaSyBVF5JPs_yXKRlrQUK3NlAm97cDntLEz9o",
  "authDomain": "gen-lang-client-0870404092.firebaseapp.com",
  "firestoreDatabaseId": "ai-studio-20bb72b2-2c7c-4bdc-967b-ecd3e4f27e13",
  "storageBucket": "gen-lang-client-0870404092.firebasestorage.app",
  "messagingSenderId": "172885729212",
  "measurementId": ""
}

Pour un écran iPhone 17 Pro Max (Retina @3x), voici la résolution maximale idéale calculée :
Calcul logique : Largeur d'écran de 440 px logiques − 48 px (marges des côtés) − 16 px (espace entre colonnes) = 376 px logiques divisés par 2 colonnes = 188 px logiques de largeur par vignette.
Résolution optimale (@3x) : 564 × 400 pixels (avec le nouveau ratio d'affichage de 1.41).


📋 BLUEPRINT TECHNIQUE : PIPELINE DE SYNTHÈSE ET DE RECONSTITUTION (PWA ⇄ ENGINE IA VIA FIRESTORE)
Ce document définit la structure des données de composition transmises par la PWA (Frontend) au Moteur de Génération IA (Backend/NodeGraph) pour chaque tâche de génération d'image (Job), ainsi que les règles de déclenchement sécurisé.
1. ARCHITECTURE DES ENTRÉES (PAYLOAD DU JOB FIRESTORE)
Chaque document de tâche contenant la demande de génération initiée par l'application intègre 6 grands blocs structurés :
code
JSON
{
  "imageA": "https://firebasestorage.googleapis.com/.../fond_selectionne.jpg",
  "presetsFond": {
    "logoAutorise": true,
    "texteAutorise": true,
    "logoPlaceholderCoords": { "x": 12, "y": 80, "w": 200, "h": 50 },
    "texteStylePreset": { "font": "Inter", "color": "#FFFFFF", "size": "normal" }
  },
  "imageB": "https://firebasestorage.googleapis.com/.../vehicule_detoure_stable.png",
  "imageC": "https://firebasestorage.googleapis.com/.../composition_reference_compressee.jpg",
  "logo": "https://firebasestorage.googleapis.com/.../logo_choisi.png",
  "metadataUtilisateur": {
    "texte": "Votre slogan ici",
    "transformVehicule": {
      "x": -2.5,
      "y": 14.2,
      "scale": 1.15,
      "rotation": -1.2
    }
  }
}
Détail des composants du Payload :
imageA (URL du Fond Statique) : Le fichier d'arrière-plan haute définition sélectionné par l'utilisateur.
presetsFond (JSON d'Intent & Règles Graphiques) :
Provient d'une table globale de configuration hébergée sur Firestore.
Indique au moteur si le logo et le texte sont autorisés, leurs coordonnées par défaut (logoPlaceholderCoords) et les styles obligatoires (texteStylePreset).
imageB (URL du Véhicule Détouré) : Image PNG transparente stable du véhicule, téléversée ou détourée côté client.
imageC (URL de la Composition de Référence - JPG Compressé) :
Spécification d'optimisation : Cette image sert uniquement de guide de mise en page visuelle globale pour l'IA générative. Afin d'accélérer les téléversements et de réduire l'usage de bande passante, elle est exportée par le canvas de la PWA au format JPEG compressé (image/jpeg avec un taux de compression d'environ 0.75), et non en PNG (plus lourd et inutile pour de la simple référence).
logo (URL du Logo - Standard ou Customisé) :
Option catalogue : URL absolue vers l'un des logos prédéfinis stockés dans le bucket d'assets partagés (gs://gen-lang-client-0870404092.firebasestorage.app/LOGOS).
Option customisée : Si l'utilisateur télécharge son propre logo (ordinateur/téléphone), le fichier est stocké dans un espace cloisonné par utilisateur (users/{userId}/logos/{timestamp}_{filename}.png), et cette URL de stockage isolée est transmise au champ logo.
metadataUtilisateur (JSON de Transformation & Saisie) :
Contient le texte saisi par l'utilisateur.
Contient l'exacte matrice géométrique appliquée à l'écran sur le véhicule : translation x & y (pourcentage ou coordonnées relatives), facteur d'échelle scale et angle de rotation (en degrés).
2. RÈGLE DE SÉCURITÉ ET DE TEMPÉRANCE (GATEKEEPER DU MOTEUR IA)
Le moteur de génération IA s'interdit d'initier tout processus ou de consommer des crédits de calcul tant que le document de tâche conserve l'état initial "waiting_inputs". Le passage à l'état "ready_to_generate" (ou le déclenchement de l'écoute Firestore) requiert la validation stricte de ces 3 piliers d'intégrité :
Validation Chimique des Canaux d'Image : Les URLs de imageA, imageB et de la référence imageC (JPEG) doivent être valides, non vides et accessibles.
Conformité de la Table des Presets :
Si presetsFond.logoAutorise === true : Le moteur exige que la clé logo contienne une URL de stockage valide.
Si presetsFond.texteAutorise === true : Le moteur exige que la clé metadataUtilisateur.texte ne soit pas vide.
Convergence des Paramètres : L'objet transformVehicule (contenant x, y, scale et rotation) doit être pleinement défini.
3. COMMENTAIRES & ANTICIPATIONS
À cette étape, la logique est fluide et parfaitement cadrée :
Découplage parfait : Le frontend crée une composition interactive légère (via le canvas) puis transmet au backend la "recette" géométrique ainsi qu'une photo instantanée basse résolution (imageC) pour que l'IA reprenne la main et génère l'image HD unifiée.
Optimisation réseau : Utiliser du JPG compressé pour l'image de référence (imageC) résout d'avance d'éventuels ralentissements d'upload depuis des connexions mobiles instables.
Gestion du dossier utilisateur : Conserver un dossier structuré par utilisateur (users/{userId}/logos/...) dans Firebase Storage garantit la conformité RGPD, sécurise l'accès et simplifiera l'affichage futur de l'historique de l'utilisateur.
