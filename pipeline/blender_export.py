"""Headless Blender step: import one model, export it as GLB, report the textures it uses.

Usage:
  blender -b --factory-startup -P blender_export.py -- <model> <out.glb> <out.json> [rotateX degrees]
"""
import json
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
model, out_glb, out_json = args[:3]
rotate_x = float(args[3]) if len(args) > 3 else 0.0
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

COLOUR_INPUTS = {"Base Color", "Color", "Alpha"}


def feeds_colour(node, depth=0):
    """True if this node's output reaches a shader's colour or alpha input.

    Modern models also carry normal, roughness and metalness maps; those would only clutter
    the hint sheet, so they're left out.
    """
    if depth > 8:
        return False
    for out in node.outputs:
        for link in out.links:
            to = link.to_node
            if to.type == "NORMAL_MAP" or to.type == "BUMP":
                continue
            if to.type.startswith("BSDF") or to.type in ("EMISSION", "OUTPUT_MATERIAL"):
                if link.to_socket.name in COLOUR_INPUTS:
                    return True
                continue
            if feeds_colour(to, depth + 1):
                return True
    return False


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
        if not feeds_colour(node):
            continue
        path = os.path.normpath(bpy.path.abspath(node.image.filepath))
        if path in seen:
            continue
        seen.add(path)
        (textures if os.path.isfile(path) else missing).append(path)

# Some rips are exported lying down; overrides.json can give an X rotation to stand them up.
if rotate_x:
    import math

    from mathutils import Matrix

    turn = Matrix.Rotation(math.radians(rotate_x), 4, "X")
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.matrix_world = turn @ o.matrix_world

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animations=False,
    export_yup=True,
)

with open(out_json, "w", encoding="utf-8") as f:
    json.dump({"textures": textures, "missing": missing}, f, indent=2)
