import os
path = r"D:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\src\App.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = "import { CommandPalette, useCommandPalette } from \"./components/CommandPalette.js\";"
new = "import { CommandPalette, useCommandPalette, CommandPaletteProvider } from \"./components/CommandPalette.js\";"
content = content.replace(old, new)
content = content.replace("return (", "return (\n      <CommandPaletteProvider>")
content = content.replace("    </div>\n  );", "    </div>\n      </CommandPaletteProvider>\n  );")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Done")
