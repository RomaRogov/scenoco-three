#!/usr/bin/env node
// The `scenoco` command. A file that exists before the build, because npm links a workspace's
// bin only if its target is there at install time — and a fresh checkout installs before it builds.
import '../dist/cli.js';
