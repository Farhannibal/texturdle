"""Headless Blender step: import one model, export it as GLB, report the textures it uses.

Usage:
  blender -b --factory-startup -P blender_export.py -- <model> <out.glb> <out.json>
"""
import json
import os
import sys

import bpy

model, out_glb, out_json = sys.argv[sys.argv.index("--") + 1:]
ext = os.path.splitext(model)[1].lower()

bpy.ops.wm.read_factory_settings(use_empty=True)

if ext == ".obj":
    bpy.ops.wm.obj_import(filepath=model)
elif ext == ".dae":
    bpy.ops.wm.collada_import(filepath=model)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=model)
elif ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=model)
else:
    raise SystemExit(f"Unsupported model format: {ext}")

textures = []
missing = []
seen = set()
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for node in mat.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        # Old games used point sampling; keep textures crisp in the viewer.
        node.interpolation = "Closest"
        path = os.path.normpath(bpy.path.abspath(node.image.filepath))
        if path in seen:
            continue
        seen.add(path)
        (textures if os.path.isfile(path) else missing).append(path)

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animations=False,
    export_yup=True,
)

with open(out_json, "w", encoding="utf-8") as f:
    json.dump({"textures": textures, "missing": missing}, f, indent=2)
