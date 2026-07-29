DOMAIN := disk-temperatures
SCHEMA := schemas/org.gnome.shell.extensions.disk-temps.gschema.xml
LANGUAGES := de hu
PO_FILES := $(LANGUAGES:%=po/%.po)
MO_FILES := $(LANGUAGES:%=locale/%/LC_MESSAGES/$(DOMAIN).mo)
POT := po/$(DOMAIN).pot
GSETTINGS_ITS := $(firstword $(wildcard /usr/share/gettext*/its/gsettings.its))

.PHONY: test translations check-translations pot pack

test: check-translations
	gjs tests/domain.test.js
	gjs tests/hardware.test.js
	gjs tests/translations.test.js
	node --check extension.js
	node --check hardware.js
	node --check i18n.js
	node --check prefs.js
	node --check tests/translations.test.js
	glib-compile-schemas --strict --dry-run schemas

translations: $(MO_FILES)

check-translations: translations
	msgcmp po/de.po $(POT)
	msgcmp po/hu.po $(POT)

locale/%/LC_MESSAGES/$(DOMAIN).mo: po/%.po
	mkdir -p $(@D)
	msgfmt --check --check-format --output-file=$@ $<

pot:
	xgettext --language=JavaScript --from-code=UTF-8 --keyword=_ \
		--package-name="Disk Temperatures" --package-version=4 \
		--copyright-holder="Bene Tamás" \
		--msgid-bugs-address="bene.tamas.84@gmail.com" \
		--sort-output --output=$(POT) extension.js prefs.js
	xgettext --join-existing --its=$(GSETTINGS_ITS) --from-code=UTF-8 \
		--package-name="Disk Temperatures" --package-version=4 \
		--copyright-holder="Bene Tamás" \
		--msgid-bugs-address="bene.tamas.84@gmail.com" \
		--sort-output --output=$(POT) $(SCHEMA)

pack: translations
	gnome-extensions pack --force \
		--extra-source=domain.js \
		--extra-source=hardware.js \
		--extra-source=i18n.js \
		--extra-source=icons \
		--extra-source=locale \
		--schema=$(SCHEMA) \
		.
