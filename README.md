<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/20bb72b2-2c7c-4bdc-967b-ecd3e4f27e13

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## ⚠️ Règles Firebase — source de vérité

Ce projet partage son projet Firebase (Firestore + Storage) avec le moteur de génération
[CAR-IA-APP_API](https://github.com/I-love-my-designer/CAR-IA-APP_API).

Les fichiers `firestore.rules` et `storage.rules` sont **unifiés et identiques dans les deux dépôts**.
**Ne les déployez PAS depuis ce dépôt** : le déploiement se fait uniquement depuis CAR-IA-APP_API
(`firebase deploy --only firestore:rules,storage`). Si une règle doit évoluer, modifiez-la dans
CAR-IA-APP_API puis recopiez le fichier ici pour garder les deux dépôts synchronisés.
