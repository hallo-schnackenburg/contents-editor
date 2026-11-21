// Generated from contents.yaml by `npm run generate` in core. Do not edit.

export const MODEL = {
  "classes": {
    "entity": {
      "label": "Entität",
      "dir": "entities"
    },
    "content": {
      "label": "Inhalt",
      "dir": "contents"
    },
    "media": {
      "label": "Medium",
      "dir": "media"
    }
  },
  "ids": {
    "slug": {
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "media": {
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{5}$"
    }
  },
  "types": {
    "person": {
      "class": "entity",
      "label": "Person",
      "dir": "entities/people",
      "id": "slug",
      "subtypes": {},
      "fields": {
        "name": {
          "label": "Name",
          "required": true
        },
        "links": {
          "label": "Links",
          "required": false
        }
      }
    },
    "organization": {
      "class": "entity",
      "label": "Organisation",
      "dir": "entities/organizations",
      "id": "slug",
      "subtypes": {},
      "fields": {
        "name": {
          "label": "Name",
          "required": true
        },
        "places": {
          "label": "Orte",
          "required": false,
          "ref": [
            "place"
          ]
        },
        "links": {
          "label": "Links",
          "required": false
        }
      }
    },
    "place": {
      "class": "entity",
      "label": "Ort",
      "dir": "entities/places",
      "id": "slug",
      "subtypes": {},
      "fields": {
        "name": {
          "label": "Name",
          "required": true
        },
        "location": {
          "label": "Lage",
          "required": false
        },
        "address": {
          "label": "Adresse",
          "required": false
        }
      }
    },
    "event": {
      "class": "entity",
      "label": "Ereignis",
      "dir": "entities/events",
      "id": "slug",
      "subtypes": {},
      "fields": {
        "name": {
          "label": "Name",
          "required": true
        },
        "recurring": {
          "label": "Wiederkehrend",
          "required": false
        },
        "organizers": {
          "label": "Veranstalter",
          "required": false,
          "ref": [
            "person",
            "organization"
          ]
        },
        "places": {
          "label": "Orte",
          "required": false,
          "ref": [
            "place"
          ]
        }
      }
    },
    "content": {
      "class": "content",
      "label": "Inhalt",
      "dir": "contents",
      "id": "slug",
      "subtypes": {},
      "fields": {
        "title": {
          "label": "Titel",
          "required": true
        },
        "authors": {
          "label": "Autoren",
          "required": false,
          "ref": [
            "person",
            "organization"
          ]
        },
        "about": {
          "label": "Handelt von",
          "required": false,
          "ref": [
            "person",
            "organization",
            "place",
            "event"
          ],
          "description": "Any entity. The type of the entry it points to says what it is."
        },
        "media": {
          "label": "Medien",
          "required": false,
          "ref": [
            "media"
          ]
        },
        "published": {
          "label": "Veröffentlicht",
          "required": false
        },
        "text": {
          "label": "Text",
          "required": true,
          "description": "One Markdown text per role, at least one. See text_roles."
        }
      }
    },
    "media": {
      "class": "media",
      "label": "Medium",
      "dir": "media",
      "id": "media",
      "subtypes": {
        "photo": "Foto",
        "drawing": "Zeichnung",
        "document": "Dokument",
        "audio": "Audio",
        "video": "Video"
      },
      "fields": {
        "title": {
          "label": "Titel",
          "required": false
        },
        "alt": {
          "label": "Alternativtext",
          "required": false,
          "description": "What is to be seen, for people who cannot see it. To be required for photo and drawing (rule not yet written)."
        },
        "caption": {
          "label": "Bildunterschrift",
          "required": false
        },
        "creator": {
          "label": "Urheber",
          "required": false,
          "ref": [
            "person",
            "organization"
          ]
        },
        "license": {
          "label": "Lizenz",
          "required": false,
          "description": "To be worked out (a list of values). Free text for now."
        },
        "date": {
          "label": "Datum",
          "required": false
        },
        "depicts": {
          "label": "Zeigt",
          "required": false,
          "ref": [
            "person",
            "organization",
            "place",
            "event"
          ]
        },
        "files": {
          "label": "Dateien",
          "required": true,
          "description": "As in the archive. One or more files, each with a role; derived files are variants of a file."
        }
      }
    }
  },
  "textRoles": {
    "body": {
      "label": "Text",
      "fallback": [],
      "description": "The full text."
    },
    "teaser": {
      "label": "Teaser",
      "max": 200,
      "fallback": [
        "summary"
      ],
      "description": "The lead-in on overviews and tiles."
    },
    "summary": {
      "label": "Zusammenfassung",
      "max": 300,
      "fallback": [
        "teaser"
      ]
    },
    "meta_description": {
      "label": "Meta-Beschreibung",
      "max": 160,
      "fallback": [
        "summary",
        "teaser"
      ],
      "description": "For search engines and link previews."
    },
    "social": {
      "label": "Social Media",
      "max": 2200,
      "fallback": [
        "teaser",
        "summary"
      ],
      "description": "To be defined with the person in charge of social media."
    },
    "print": {
      "label": "Print",
      "fallback": [
        "body"
      ],
      "description": "For the Amtsblatt, notices, newspapers."
    }
  }
} as const

export type EntryType = keyof typeof MODEL.types
export type EntryClass = keyof typeof MODEL.classes
export type TextRole = keyof typeof MODEL.textRoles

export const ENTRY_TYPES = Object.keys(MODEL.types) as EntryType[]
export const TEXT_ROLES = Object.keys(MODEL.textRoles) as TextRole[]
