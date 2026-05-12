# Launch Open Interpreter

Return a Ploinky WebChat launch URL for `openInterpreterAgent` using the
current AchillesCLI working directory.

## Input Format
- **promptText** (string, optional): Ignored by the launcher.
- **workingDir** (string, optional): Programmatic override for the directory to
  pass as `dir`.
- **workspaceRoot** (string, optional): Programmatic override for confinement.

In normal WebChat use, AchillesCLI provides `context.workingDir`.

## Output Format
Returns a string. The first line is always a URL beginning with
`/webchat?agent=openInterpreterAgent`. A second `note:` line is included when
the launcher cannot confirm that `openInterpreterAgent` is present in the
current Ploinky routing file.
