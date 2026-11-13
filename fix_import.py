with open("src/components/WorkbenchLayout.tsx", "r", encoding="utf-8") as f: lines = f.readlines()
lines.insert(6, "import { DeveloperCockpit } from \"./DeveloperCockpit.js\";\n")
with open("src/components/WorkbenchLayout.tsx", "w", encoding="utf-8") as f: f.writelines(lines)
print("Done")
