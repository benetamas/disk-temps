SCHEMA := schemas/org.gnome.shell.extensions.disk-temps.gschema.xml

.PHONY: test pack

test:
	gjs tests/domain.test.js
	gjs tests/hardware.test.js
	node --check extension.js
	node --check hardware.js
	node --check prefs.js
	glib-compile-schemas --strict --dry-run schemas

pack:
	gnome-extensions pack --force \
		--extra-source=domain.js \
		--extra-source=hardware.js \
		--extra-source=icons \
		--schema=$(SCHEMA) \
		.
