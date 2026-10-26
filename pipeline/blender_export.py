"""Headless Blender step: import one model, export it as GLB, report the textures it uses
plus some stats for the review page, and optionally render a preview image.

Usage:
  blender -b --factory-startup -P blender_export.py -- <model> <out.glb> <out.json> [rotateX degrees] [preview.png]
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
model, out_glb, out_json = args[:3]
rotate_x = float(args[3]) if len(args) > 3 else 0.0
preview = args[4] if len(args) > 4 else ""
ext = os.path.splitext(model)[1].lower()

if ext == ".blend":
    # Blender's own format: open it directly, nothing to convert.
    bpy.ops.wm.open_mainfile(filepath=model)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)

if ext == ".blend":
    # Textures packed inside the .blend have no file on disk; write them out so the hint
    # sheet can use them.
    unpack_dir = os.path.join(os.path.dirname(out_json), "_unpacked")
    for img in bpy.data.images:
        if img.packed_file and img.size[0]:
            os.makedirs(unpack_dir, exist_ok=True)
            name = "".join(c if c.isalnum() or c in "-_." else "_" for c in img.name)
            target = os.path.join(unpack_dir, os.path.splitext(name)[0] + ".png")
            img.filepath_raw = target
            img.file_format = "PNG"
            img.save()
elif ext == ".obj":
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
untextured = 0
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    has_colour_texture = False
    for node in mat.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        # Old games used point sampling; keep textures crisp in the viewer.
        node.interpolation = "Closest"
        if not feeds_colour(node):
            continue
        has_colour_texture = True
        path = os.path.normpath(bpy.path.abspath(node.image.filepath))
        if path in seen:
            continue
        seen.add(path)
        (textures if os.path.isfile(path) else missing).append(path)
    if not has_colour_texture and mat.users:
        untextured += 1

# Some rips are exported lying down; overrides.json can give an X rotation to stand them up.
if rotate_x:
    turn = Matrix.Rotation(math.radians(rotate_x), 4, "X")
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.matrix_world = turn @ o.matrix_world

# Stats for the review page. Blender is Z-up: x = width, y = depth, z = height.
bpy.context.view_layer.update()
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners))) if corners else Vector()
hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners))) if corners else Vector()
size = hi - lo
tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)

# Modern rips can carry 4096px textures, which bloat the model past what the web needs
# (and past Cloudflare's 25 MiB file limit). The viewer never shows more than ~1024px.
MAX_TEXTURE = 1024
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > MAX_TEXTURE:
        s = MAX_TEXTURE / max(w, h)
        img.scale(max(1, round(w * s)), max(1, round(h * s)))

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animations=False,
    export_yup=True,
)

# A quick front-on render (Workbench, textured, transparent background) for reviewing
# a batch without loading every model in the browser.
if preview and corners:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 384
    scene.render.image_settings.file_format = "PNG"
    centre = (lo + hi) / 2
    radius = max(size.length / 2, 1e-6)
    cam_data = bpy.data.cameras.new("preview")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(35)
    cam_data.clip_start = radius / 100
    cam_data.clip_end = radius * 20
    cam = bpy.data.objects.new("preview", cam_data)
    scene.collection.objects.link(cam)
    dist = radius / math.sin(cam_data.angle / 2) * 1.02
    # Front of the model faces -Y in Blender (+Z once exported to glTF).
    cam.location = centre + Vector((0, -dist, radius * 0.25))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(
        {
            "textures": textures,
            "missing": missing,
            "untexturedMaterials": untextured,
            "triangles": tris,
            "size": {"width": size.x, "depth": size.y, "height": size.z},
        },
        f,
        indent=2,
    )
