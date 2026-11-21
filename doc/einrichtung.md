# Einrichtung: Änderungen, Webhook, Prüfung

Eine Änderung ist ein Branch `change/<login>/<name>` mit einem Pull Request. Der Editor legt beides beim ersten
Speichern an (der PR als Entwurf). Übernommen wird per Squash-Merge nach `main`. Wer das darf, entscheidet GitHub.

## 1. GitHub App (je dev, staging, production)

**Repository-Rechte** (Settings der App → Permissions & events):

| Recht | Zugriff | wofür |
|---|---|---|
| Contents | Read & write | Einträge lesen und speichern, Branch anlegen und nach dem Übernehmen löschen |
| Pull requests | Read & write | Änderungen anlegen, einreichen, übernehmen, schließen, kommentieren |
| Checks | Read-only | Stand der automatischen Prüfung anzeigen |
| Metadata | Read-only | (immer) |

Nach einer Änderung der Rechte muss jede Person die App neu bestätigen (GitHub zeigt es beim nächsten Anmelden).

**Webhook** (gleiche Seite, „Webhook“): *Active*, `Webhook secret` = ein langer Zufallswert (`openssl rand -hex 32`),
dazu unter „Subscribe to events“: Pull request, Push, Issue comment, Pull request review comment, Check run, Check suite.

| Umgebung | Webhook URL |
|---|---|
| dev | `https://<tunnel>/hook/github` (der Tunnel zeigt auf den Worker, Port 8788) |
| staging | `https://contents-editor-staging.schnackenburg.de/api/hook/github` |
| production | `https://contents-editor.schnackenburg.de/api/hook/github` |

Derselbe Wert kommt als `WEBHOOK_SECRET` in `worker/.secrets/<umgebung>` (Vorlage: `worker/.secrets/example`).
Für staging und production: `bash .secrets/upload-secrets.sh staging` (bzw. `production`) im Ordner `worker/`.

Ohne Webhook funktioniert alles, die Oberfläche fragt dann nur einmal pro Minute nach (der Punkt oben rechts ist grau).

## 2. Prüfung in den Datenrepos

`templates/validate.yml` nach `.github/workflows/validate.yml` kopieren, in `contents`, `contents-staging` und
`contents-dev`. Die Prüfung heißt `validate` und läuft bei jedem Pull Request. Sie prüft jeden Eintrag und die
Verweise der Einträge untereinander (`npm run validate-repo -- <Ordner>` im Editor-Repo macht dasselbe lokal).

In der Vorlage steht `hallo-schnackenburg/contents-editor` als Repo des Editors; anpassen, falls es anders heißt.

## 3. `main` schützen

Repository → Settings → Rules → Rulesets (oder Branches → Branch protection rule) für `main`:

- *Require a pull request before merging* (keine Freigaben nötig, es gibt keine Rollen)
- *Require status checks to pass*: `validate`
- *Block force pushes*

Damit kann niemand am Editor vorbei Ungültiges nach `main` bringen, und „Übernehmen“ klappt erst, wenn die Prüfung
grün ist.

## 4. Lokal

```
npm run dev:worker   # Terminal 1: Worker auf Port 8788
npm run dev          # Terminal 2: die App auf Port 5174
npm run dev:fake     # ohne GitHub: Beispieldaten im Speicher, bernd hat eine eingereichte Änderung
```

Der alte Branch `edit/<login>` aus der ersten Version wird nicht mehr benutzt und kann gelöscht werden.
