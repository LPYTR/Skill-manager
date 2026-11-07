"""Deterministic local pet tooling. This module never generates character art."""
from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

CW, CH, COLS, MAX_BYTES = 192, 208, 8, 20 * 1024 * 1024
SPECS = [
    ("idle", 6, [280, 110, 110, 140, 140, 320]),
    ("running-right", 8, [120] * 7 + [220]),
    ("running-left", 8, [120] * 7 + [220]),
    ("waving", 4, [140] * 3 + [280]),
    ("jumping", 5, [140] * 4 + [280]),
    ("failed", 8, [140] * 7 + [240]),
    ("waiting", 6, [150] * 5 + [260]),
    ("running", 6, [120] * 5 + [220]),
    ("review", 6, [150] * 5 + [280]),
]
LOOK = ["000", "022.5", "045", "067.5", "090", "112.5", "135", "157.5",
        "180", "202.5", "225", "247.5", "270", "292.5", "315", "337.5"]
DIRECTIONS = ["up", "up-right", "up-right", "up-right", "right", "down-right", "down-right", "down-right",
              "down", "down-left", "down-left", "down-left", "left", "up-left", "up-left", "up-left"]


def configure_console():
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,"reconfigure"):
            stream.reconfigure(encoding="utf-8",errors="backslashreplace")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def color(value):
    if value is None or str(value).lower() == "none":
        return None
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        raise ValueError("Chroma key must be #RRGGBB or none")
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def state_specs(version):
    return SPECS + ([("look-row-9", 8, []), ("look-row-10", 8, [])] if version == 2 else [])


def alpha_bbox(image):
    return image.getchannel("A").point(lambda x: 255 if x > 16 else 0).getbbox()


def clear_hidden(image):
    data = bytearray(image.convert("RGBA").tobytes())
    for i in range(0, len(data), 4):
        if data[i+3] == 0:
            data[i:i+3] = b"\0\0\0"
    return Image.frombytes("RGBA", image.size, bytes(data))


def visible_signature(image):
    rgba=image.convert("RGBA")
    views=[rgba.getchannel("A")]
    for background in ("#20242b","#f3f3f3"):
        canvas=Image.new("RGBA",rgba.size,background)
        canvas.alpha_composite(rgba)
        views.append(canvas.convert("RGB"))
    return views


def same_visible(first,second,tolerance=2):
    return all(max(high for low,high in ImageChops.difference(a,b).getextrema())<=tolerance
               if a.mode!="L" else ImageChops.difference(a,b).getextrema()[1]<=tolerance
               for a,b in zip(first,second))


def motion_stats(frames,durations=None):
    representatives=[];groups=[]
    for frame in frames:
        view=visible_signature(frame)
        group=next((index for index,previous in enumerate(representatives) if same_visible(view,previous)),None)
        if group is None:
            group=len(representatives);representatives.append(view)
        groups.append(group)
    changes=sum(group!=groups[index-1] for index,group in enumerate(groups))
    result={"distinct_visible_poses":len(representatives),"pose_groups":groups,"pose_changes_per_cycle":changes}
    if durations is not None:
        holds=[]
        for index,duration in enumerate(durations):
            if index and groups[index]==groups[index-1]: holds[-1]+=duration
            else: holds.append(duration)
        if len(holds)>1 and groups[0]==groups[-1]: holds[0]+=holds.pop()
        result.update(loop_ms=sum(durations),pose_holds_ms=holds)
    return result


def timing_specs(profile="base",idle_multiplier=None):
    if profile not in {"base","native"}: raise ValueError("Unknown timing profile")
    if profile=="native" and (idle_multiplier is None or not math.isfinite(idle_multiplier) or idle_multiplier<=0):
        raise ValueError("Native timing requires --idle-multiplier from the inspected client")
    if profile=="base" and idle_multiplier is not None:
        raise ValueError("An idle multiplier requires --timing-profile native")
    return [(state,count,[max(1,round(t*(idle_multiplier if state=="idle" and profile=="native" else 1))) for t in times])
            for state,count,times in SPECS]


def encode(image, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    image = clear_hidden(image)
    if path.suffix.lower() == ".webp":
        image.save(path, lossless=True, quality=100, method=6, exact=True)
    elif path.suffix.lower() == ".png":
        image.save(path)
    else:
        raise ValueError("Output must be .png or .webp")


def remove_key(image, key, threshold=96):
    image = image.convert("RGBA")
    if key is None:
        return image
    data = bytearray(image.tobytes())
    for i in range(0, len(data), 4):
        if sum((data[i+c]-key[c])**2 for c in range(3)) <= threshold**2:
            data[i:i+4] = b"\0\0\0\0"
    return Image.frombytes("RGBA", image.size, bytes(data))


def components(image):
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    seen = bytearray(len(alpha))
    found = []
    for start, value in enumerate(alpha):
        if value <= 16 or seen[start]:
            continue
        queue = [start]
        seen[start] = 1
        pixels = []
        left, top, right, bottom = width, height, 0, 0
        while queue:
            current = queue.pop()
            pixels.append(current)
            x, y = current % width, current // width
            left, top, right, bottom = min(left, x), min(top, y), max(right, x+1), max(bottom, y+1)
            neighbors = []
            if x: neighbors.append(current-1)
            if x+1 < width: neighbors.append(current+1)
            if y: neighbors.append(current-width)
            if y+1 < height: neighbors.append(current+width)
            for neighbor in neighbors:
                if not seen[neighbor] and alpha[neighbor] > 16:
                    seen[neighbor] = 1
                    queue.append(neighbor)
        found.append({"pixels": pixels, "area": len(pixels), "bbox": [left, top, right, bottom],
                      "center": (left+right)/2})
    return found


def extract_groups(image, count):
    found = components(image)
    if not found:
        raise ValueError("No visible artwork after background removal")
    largest = max(c["area"] for c in found)
    seeds = sorted([c for c in found if c["area"] >= max(120, largest * .2)], key=lambda c: c["center"])
    if len(seeds) != count:
        raise ValueError(f"Found {len(seeds)} dominant groups; expected {count}. Repair merged/clipped/extra source poses; no slot fallback.")
    groups = [[seed] for seed in seeds]
    for piece in found:
        if any(piece is seed for seed in seeds) or piece["area"] < max(3, largest * .0005):
            continue
        index = min(range(count), key=lambda n: abs(seeds[n]["center"]-piece["center"]))
        if abs(piece["center"]-seeds[index]["center"]) > image.width/count*.45:
            raise ValueError("A detached fragment cannot be safely assigned to a pose")
        groups[index].append(piece)
    return groups


def extract(args):
    run = Path(args.run).resolve()
    brief = read_json(run/"brief.json")
    specs = {name: count for name, count, _ in state_specs(brief["version"])}
    if args.state not in specs:
        raise ValueError("State is not part of the run's declared version")
    expected = specs[args.state]
    source_count = args.source_count or expected
    if source_count * args.repeat != expected:
        raise ValueError("Source count multiplied by repeat must equal the required frame count")
    if args.repeat != 1 and args.state not in {"running-right", "running-left"}:
        raise ValueError("Explicit phase repetition is supported only for directional movement")
    chosen = args.key if args.key is not None else brief["chroma_key"]
    if chosen.lower() != brief["chroma_key"].lower():
        raise ValueError("The strip key must match the declared run key")
    with Image.open(args.strip) as opened:
        image = remove_key(ImageOps.exif_transpose(opened), color(chosen), args.threshold)
    groups = extract_groups(image, source_count)
    bounds = [[min(c["bbox"][0] for c in group), min(c["bbox"][1] for c in group),
               max(c["bbox"][2] for c in group), max(c["bbox"][3] for c in group)] for group in groups]
    if not 0 <= args.reference_index < source_count:
        raise ValueError("Reference index is outside the source poses")
    for bound in bounds:
        if bound[0] <= 0 or bound[1] <= 0 or bound[2] >= image.width or bound[3] >= image.height:
            raise ValueError("Source artwork touches its outer canvas; inspect clipping before extraction")
    ref = bounds[args.reference_index]
    shared_ground = max(b[3] for b in bounds)
    scale = min(args.height/(ref[3]-ref[1]), (CW-12)/max(b[2]-b[0] for b in bounds),
                (CH-12)/(shared_ground-min(b[1] for b in bounds)))
    directory = run/"frames"/args.state
    if directory.exists() and any(directory.iterdir()) and not args.replace:
        raise ValueError("Frames already exist. Preserve the prior revision, then pass --replace explicitly")
    directory.mkdir(parents=True, exist_ok=True)
    all_rgba = image.tobytes()
    frames = []
    for group, bound in zip(groups, bounds):
        left, top, right, bottom = bound
        data = bytearray((right-left)*(bottom-top)*4)
        for piece in group:
            for offset in piece["pixels"]:
                x, y = offset % image.width, offset // image.width
                destination = ((y-top)*(right-left)+x-left)*4
                data[destination:destination+4] = all_rgba[offset*4:offset*4+4]
        pose = Image.frombytes("RGBA", (right-left, bottom-top), bytes(data))
        pose = pose.resize((max(1,round(pose.width*scale)),max(1,round(pose.height*scale))), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CW,CH))
        y = round(args.ground-(shared_ground-top)*scale)
        x = round((CW-pose.width)/2)
        if y < 2 or y+pose.height > CH-2:
            raise ValueError("Registration would clip a pose; use a smaller shared height/ground or fix the source")
        canvas.alpha_composite(pose,(x,y))
        frames.append(canvas)
    for index, frame in enumerate(frames*args.repeat):
        encode(frame,directory/f"{index:02d}.png")
    report = {"state":args.state,"source":str(Path(args.strip).resolve()),"source_sha256":digest(args.strip),
              "method":"connected-groups","source_count":source_count,"repeat":args.repeat,
              "shared_scale":scale,"source_bounds":bounds,"ground":args.ground,
              "reference_index":args.reference_index,"visual_review":"pending"}
    write_json(run/"qa"/f"extraction-{args.state}.json", report)
    return report


def despill(image, key):
    if key is None:
        return clear_hidden(image), 0
    rgba=image.convert("RGBA")
    alpha=rgba.getchannel("A")
    edge=alpha.filter(ImageFilter.MinFilter(11)).tobytes()
    data=bytearray(rgba.tobytes())
    high=[i for i,c in enumerate(key) if c >= max(key)-24]
    low=[i for i in range(3) if i not in high]
    changed=0
    if not low:
        raise ValueError("Use a saturated contrasting chroma key, not black/white/gray")
    for index in range(len(edge)):
        offset=index*4
        if not data[offset+3] or edge[index] >= 250:
            continue
        excess=min(data[offset+c] for c in high)-max(data[offset+c] for c in low)
        if excess > 32:
            for channel in high: data[offset+channel]-=excess
            changed+=1
    return clear_hidden(Image.frombytes("RGBA",rgba.size,bytes(data))),changed


def assemble(args):
    run=Path(args.run).resolve()
    brief=read_json(run/"brief.json")
    specs=state_specs(brief["version"])
    atlas=Image.new("RGBA",(CW*COLS,CH*len(specs)))
    for row,(state,count,_) in enumerate(specs):
        paths=sorted((run/"frames"/state).glob("[0-9][0-9].png"))
        if len(paths)!=count: raise ValueError(f"{state}: need exactly {count} frames, found {len(paths)}")
        for col,path in enumerate(paths):
            with Image.open(path) as frame:
                if frame.size!=(CW,CH): raise ValueError(f"Frame is not 192x208: {path}")
                atlas.alpha_composite(frame.convert("RGBA"),(col*CW,row*CH))
    atlas,changed=despill(atlas,color(brief["chroma_key"]))
    output=run/"final"/"spritesheet.png"
    encode(atlas,output)
    report=validate_image(output,brief["chroma_key"])
    report["despill_pixels"]=changed
    write_json(run/"qa"/"format-validation.json",report)
    if not report["ok"]: raise ValueError("Atlas validation failed; inspect qa/format-validation.json")
    return report


def validate_image(path, key=None):
    path=Path(path).resolve()
    errors=[]
    cells=[];motion={}
    size=path.stat().st_size
    if not 0 < size <= MAX_BYTES: errors.append("Encoded file must be between 1 byte and 20 MiB")
    with Image.open(path) as opened:
        version={9:1,11:2}.get(opened.height//CH)
        fmt=opened.format
        if fmt not in {"PNG","WEBP"}: errors.append("Only PNG/WebP is supported")
        if {"PNG":".png","WEBP":".webp"}.get(fmt)!=path.suffix.lower(): errors.append("Extension and encoded format disagree")
        if getattr(opened,"is_animated",False): errors.append("Animated masters require separate desktop temporal validation")
        if opened.width!=1536 or opened.height not in {1872,2288}: errors.append("Unsupported atlas dimensions")
        atlas=opened.convert("RGBA")
    if not errors:
        chroma=color(key)
        for row,(state,count,_) in enumerate(state_specs(version)):
            row_frames=[]
            for col in range(8):
                cell=atlas.crop((col*CW,row*CH,(col+1)*CW,(row+1)*CH))
                alpha=cell.getchannel("A")
                box=alpha_bbox(cell)
                if col>=count:
                    if alpha.getbbox(): errors.append(f"Nontransparent unused cell {row}/{col}")
                    continue
                if box is None:
                    errors.append(f"Empty used cell {row}/{col}")
                    continue
                if box[0]<2 or box[1]<2 or box[2]>CW-2 or box[3]>CH-2:
                    errors.append(f"Artwork touches safe cell edge {row}/{col}")
                histogram=alpha.histogram()
                visible=sum(histogram[17:])
                if visible < 100 or visible > CW*CH*.95: errors.append(f"Sparse/opaque used cell {row}/{col}")
                if chroma:
                    pixels=cell.tobytes()
                    leaked=sum(1 for i in range(0,len(pixels),4) if pixels[i+3]>16 and
                               sum((pixels[i+c]-chroma[c])**2 for c in range(3))<=36**2)
                    if leaked: errors.append(f"Chroma contamination in cell {row}/{col}: {leaked} pixels")
                cells.append({"state":state,"row":row,"column":col,"bbox":box,"visible_pixels":visible})
                row_frames.append(cell)
            if row<9 and len(row_frames)==count:
                motion[state]=motion_stats(row_frames)
                if motion[state]["distinct_visible_poses"]<2:
                    errors.append(f"Frozen animation row {row} ({state}): fewer than two visibly different poses")
    idle=[c["bbox"][3] for c in cells if c["row"]==0]
    jump=[c["bbox"][3] for c in cells if c["row"]==4]
    metrics={"states":motion}
    if len(idle)==6 and len(jump)==5:
        import statistics
        metrics.update(jump_lift_px=max(jump)-min(jump),landing_delta_px=abs(jump[-1]-statistics.median(idle)))
    return {"ok":not errors,"errors":errors,"file":str(path),"sha256":digest(path),"encoded_bytes":size,
            "version":version,"width":atlas.width,"height":atlas.height,"format":fmt,"cells":cells,
            "motion_metrics":metrics,"chroma_key":key,"visual_semantics_certified":False}


def save_gif(frames,times,path):
    frames[0].save(path,save_all=True,append_images=frames[1:],duration=times,loop=0,disposal=2,optimize=False)


def labeled(frame,label):
    canvas=Image.new("RGB",(240,256),"#eef0f4")
    canvas.paste(frame,(24,34),frame)
    ImageDraw.Draw(canvas).text((12,10),label,fill="#273243")
    return canvas


def required_previews(version,mp4):
    files=["all-states.gif","four-stills.png","contact.png","idle-jump-idle.gif"]+[f"{s}.gif" for s,_,_ in SPECS]
    if version==2: files += ["gaze.png","look-loop.gif"]
    if mp4: files.append("all-states.mp4")
    return files


def validate_previews(root,expected_hash,version):
    root=Path(root).resolve();report=read_json(root/"previews.json")
    if report.get("image_sha256")!=expected_hash or report.get("mp4") not in (True,False):
        raise ValueError("Preview manifest is stale or incomplete")
    required=required_previews(version,report["mp4"])+["preview.html",report.get("image_asset","")]
    hashes=report.get("file_sha256",{})
    for filename in required:
        if not filename or Path(filename).name!=filename:
            raise ValueError("Preview paths must remain inside the preview directory")
        path=root/filename
        if not path.is_file() or not hashes.get(filename) or digest(path)!=hashes[filename]:
            raise ValueError(f"Preview missing, changed or unbound: {filename}")
        if path.suffix.lower()==".gif":
            with Image.open(path) as image:
                if image.format!="GIF" or image.n_frames<2: raise ValueError(f"Preview is not moving GIF artwork: {filename}")
                duration=0
                for index in range(image.n_frames):
                    image.seek(index);image.load();duration+=image.info.get("duration",0)
                if duration<=0: raise ValueError(f"GIF has no usable timing: {filename}")
        elif path.suffix.lower() in {".png",".webp"}:
            with Image.open(path) as image: image.verify()
        elif path.suffix.lower()==".mp4":
            with path.open("rb") as stream: header=stream.read(12)
            if len(header)<12 or header[4:8]!=b"ftyp": raise ValueError("Generated video is not an MP4 file")
    if digest(root/report["image_asset"])!=expected_hash:
        raise ValueError("Preview viewer uses different atlas bytes")
    return report


def previews(args):
    validation=validate_image(args.image)
    if not validation["ok"]: raise ValueError("Cannot preview an invalid static atlas")
    if not .1 <= args.speed <= 3: raise ValueError("Speed must be between 0.1 and 3")
    profile=getattr(args,"timing_profile","base")
    multiplier=getattr(args,"idle_multiplier",None)
    specs=timing_specs(profile,multiplier)
    root=Path(args.output).resolve();root.mkdir(parents=True,exist_ok=True)
    atlas=Image.open(args.image).convert("RGBA")
    all_frames=[];all_times=[];states={};durations={}
    contact=Image.new("RGB",(240*8,256*len(state_specs(validation["version"]))),"#eef0f4")
    for row,(state,count,times) in enumerate(state_specs(validation["version"])):
        frames=[atlas.crop((c*CW,row*CH,(c+1)*CW,(row+1)*CH)) for c in range(count)]
        for col,frame in enumerate(frames): contact.paste(labeled(frame,f"{state} {col+1}"),(240*col,256*row))
        if row>=9: continue
        times=specs[row][2]
        scaled=[max(10,round(t/args.speed/10)*10) for t in times]
        states[state]=frames;durations[state]=scaled
        save_gif(frames,scaled,root/f"{state}.gif")
        all_frames.extend(labeled(f,f"{state} {i+1}") for i,f in enumerate(frames))
        all_times.extend(scaled)
    contact.save(root/"contact.png")
    save_gif(all_frames,all_times,root/"all-states.gif")
    save_gif(states["idle"]+states["jumping"]+states["idle"],durations["idle"]+durations["jumping"]+durations["idle"],root/"idle-jump-idle.gif")
    stills=Image.new("RGB",(960,256),"#eef0f4")
    for index,(state,col) in enumerate((("idle",0),("waving",1),("jumping",2),("review",3))):
        stills.paste(labeled(states[state][col],f"{state} {col+1}"),(index*240,0))
    stills.save(root/"four-stills.png")
    if validation["version"]==2:
        looks=[atlas.crop((c*CW,r*CH,(c+1)*CW,(r+1)*CH)) for r in (9,10) for c in range(8)]
        gaze=Image.new("RGB",(192*8,240*2),"#eef0f4")
        for i,frame in enumerate(looks):
            x,y=(i%8)*192,(i//8)*240
            gaze.paste(frame,(x,y+25),frame)
            ImageDraw.Draw(gaze).text((x+3,y+4),f"{LOOK[i]} {DIRECTIONS[i]}",fill="black")
        gaze.save(root/"gaze.png")
        save_gif([labeled(f,f"Look {label}") for f,label in zip(looks,LOOK)],[round(240/args.speed/10)*10]*16,root/"look-loop.gif")
    mp4=False
    try:
        import imageio_ffmpeg
        writer=imageio_ffmpeg.write_frames(str(root/"all-states.mp4"),(240,256),fps=25,codec="libx264",pix_fmt_in="rgb24",pix_fmt_out="yuv420p")
        writer.send(None);elapsed=0;emitted=0
        try:
            for frame,time in zip(all_frames,all_times):
                elapsed+=time;target=round(elapsed/40)
                for _ in range(target-emitted): writer.send(frame.tobytes())
                emitted=target
        finally: writer.close()
        mp4=True
    except ImportError:
        if args.require_mp4: raise ValueError("imageio-ffmpeg is required for MP4")
    asset_name="atlas"+Path(args.image).suffix.lower()
    shutil.copy2(args.image,root/asset_name)
    viewer=Path(__file__).resolve().parent.parent/"assets"/"preview.html"
    config={"image":asset_name,"version":validation["version"],"speed":args.speed,"mp4":mp4,
            "timing_profile":profile,"idle_multiplier":multiplier,"action_cycles":3 if profile=="native" else None,
            "states":[{"state":s,"frames":n,"durations":d} for s,n,d in specs]}
    text=viewer.read_text(encoding="utf-8").replace("__PROFILE_JSON__",json.dumps(config).replace("<","\\u003c"))
    (root/"preview.html").write_text(text,encoding="utf-8")
    generated=required_previews(validation["version"],mp4)+["preview.html",asset_name]
    report={"image_sha256":validation["sha256"],"image":str(Path(args.image).resolve()),"image_asset":asset_name,"speed":args.speed,
            "timing_profile":profile,"idle_multiplier":multiplier,"viewer_action_cycles":config["action_cycles"],
            "native_playback_changed":False,
            "durations":durations,"mp4":mp4,"output":str(root),"from_encoded_atlas":True,
            "file_sha256":{name:digest(root/name) for name in generated}}
    write_json(root/"previews.json",report)
    validate_previews(root,validation["sha256"],validation["version"])
    return report


def retime(args):
    source_path=Path(args.image).resolve();output=Path(args.output).resolve()
    if output==source_path or output.exists(): raise ValueError("Preserve the source and choose a new revision filename")
    validation=validate_image(source_path)
    if not validation["ok"]: raise ValueError("Retime needs a valid static source atlas")
    mapping=read_json(args.frame_map).get("states")
    counts={s:n for s,n,_ in SPECS}
    if not isinstance(mapping,dict) or not mapping or set(mapping)-set(counts):
        raise ValueError("Frame map must have a nonempty states object containing standard state names only")
    for state,indices in mapping.items():
        if not isinstance(indices,list) or len(indices)!=counts[state] or any(type(i) is not int or not 0<=i<counts[state] for i in indices):
            raise ValueError(f"Frame map for {state} must select exactly {counts[state]} in-range source columns")
    specs=timing_specs(getattr(args,"timing_profile","base"),getattr(args,"idle_multiplier",None))
    source=Image.open(source_path).convert("RGBA");atlas=source.copy();rows={}
    for row,(state,count,durations) in enumerate(specs):
        original=[source.crop((col*CW,row*CH,(col+1)*CW,(row+1)*CH)) for col in range(count)]
        indices=mapping.get(state,list(range(count)))
        selected=[original[index] for index in indices]
        before=motion_stats(original,durations);after=motion_stats(selected,durations)
        if after["distinct_visible_poses"]<2: raise ValueError(f"Frame map would freeze {state}")
        for col,frame in enumerate(selected): atlas.paste(frame,(col*CW,row*CH))
        rows[state]={"source_columns":indices,"before":before,"after":after,
                     "pose_change_ratio":after["pose_changes_per_cycle"]/before["pose_changes_per_cycle"]}
    encode(atlas,output)
    result=validate_image(output)
    if not result["ok"]: raise ValueError("Retimed atlas failed validation")
    if result["sha256"]==validation["sha256"]: raise ValueError("Frame map made no change; inspect the selected source phases")
    if "jumping" in mapping:
        metrics=result["motion_metrics"]
        if metrics.get("jump_lift_px",0)<8 or metrics.get("landing_delta_px",999)>12:
            raise ValueError("Frame map removed jump lift or natural landing")
    report={"ok":True,"source":str(source_path),"source_sha256":validation["sha256"],
            "image":str(output),"image_sha256":result["sha256"],"frame_map_sha256":digest(args.frame_map),
            "rows":rows,"timing_profile":getattr(args,"timing_profile","base"),
            "idle_multiplier":getattr(args,"idle_multiplier",None),"validation":result,
            "loop_periods_changed":False,"playback_rate_changed":False,"native_metadata_changed":False,
            "needs_new_visual_review":True,
            "limitations":["Longer holds can look more stepped; pose-change ratio is not a global playback-rate multiplier."]}
    write_json(args.report,report)
    return report


def check_review(review,report):
    if review.get("image_sha256")!=report["sha256"] or review.get("overall") not in {"pass","warning"} or review.get("motion_seen") is not True:
        raise ValueError("Need passing visual/motion review bound to these exact image bytes")
    for state,_,_ in SPECS:
        record=review.get("states",{}).get(state,{})
        if record.get("verdict") not in {"pass","warning"} or len(record.get("evidence",""))<10:
            raise ValueError(f"Missing/non-passing concrete visual evidence for {state}")
    warning_present=review.get("overall")=="warning" or any(r.get("verdict")=="warning" for r in review.get("states",{}).values()) or any(r.get("verdict")=="warning" for r in review.get("directions",{}).values())
    if warning_present and not any(isinstance(item,str) and len(item)>=10 for item in review.get("limitations",[])):
        raise ValueError("Accepted visual warnings require a concrete recorded limitation")
    if report["version"]==2:
        for label,expected in zip(LOOK,DIRECTIONS):
            record=review.get("directions",{}).get(label,{})
            allowed={"pass"} if label in {"000","090","180","270"} else {"pass","warning"}
            if record.get("verdict") not in allowed or record.get("observed","").removeprefix("screen-")!=expected or len(record.get("evidence",""))<10:
                raise ValueError(f"Missing/ambiguous/wrong gaze evidence for {label}")
    metrics=report["motion_metrics"]
    if metrics.get("jump_lift_px",0)<8 or metrics.get("landing_delta_px",999)>12:
        raise ValueError("Jump does not visibly leave/return to the idle ground")


def release(args):
    run=Path(args.run).resolve();brief=read_json(run/"brief.json")
    report=validate_image(args.image,brief["chroma_key"])
    if not report["ok"]: raise ValueError("Format validation failed")
    if report["version"]!=brief["version"]: raise ValueError("Atlas version differs from the approved run version")
    review=read_json(args.review)
    check_review(review,report)
    preview_root=Path(args.previews).resolve()
    validate_previews(preview_root,report["sha256"],report["version"])
    result={"kind":"static","pet_id":brief["pet_id"],"name":brief["name"],"description":brief.get("description",""),
            "image":str(Path(args.image).resolve()),"image_sha256":report["sha256"],"version":report["version"],
            "validation":report,"review":str(Path(args.review).resolve()),"review_sha256":digest(args.review),
            "previews":str(preview_root),"preview_manifest_sha256":digest(preview_root/"previews.json"),
            "limitations":review.get("limitations",[])}
    write_json(run/"final"/"release.json",result)
    return {"release":str(run/"final"/"release.json"),"image_sha256":report["sha256"]}


def main():
    configure_console()
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("init");p.add_argument("--run",required=True);p.add_argument("--name",required=True);p.add_argument("--pet-id",required=True);p.add_argument("--version",type=int,choices=[1,2],default=1);p.add_argument("--key",default="#FF00FF");p.add_argument("--description",default="")
    p=sub.add_parser("extract");p.add_argument("--run",required=True);p.add_argument("--state",required=True);p.add_argument("--strip",required=True);p.add_argument("--key");p.add_argument("--threshold",type=float,default=96);p.add_argument("--source-count",type=int);p.add_argument("--repeat",type=int,default=1);p.add_argument("--reference-index",type=int,default=0);p.add_argument("--height",type=int,default=180);p.add_argument("--ground",type=int,default=200);p.add_argument("--replace",action="store_true")
    p=sub.add_parser("assemble");p.add_argument("--run",required=True)
    p=sub.add_parser("validate");p.add_argument("image");p.add_argument("--key");p.add_argument("--report",required=True)
    p=sub.add_parser("previews");p.add_argument("image");p.add_argument("--output",required=True);p.add_argument("--speed",type=float,default=1);p.add_argument("--require-mp4",action="store_true");p.add_argument("--timing-profile",choices=["base","native"],default="base");p.add_argument("--idle-multiplier",type=float)
    p=sub.add_parser("retime");p.add_argument("image");p.add_argument("--frame-map",required=True);p.add_argument("--output",required=True);p.add_argument("--report",required=True);p.add_argument("--timing-profile",choices=["base","native"],default="base");p.add_argument("--idle-multiplier",type=float)
    p=sub.add_parser("release");p.add_argument("--run",required=True);p.add_argument("--image",required=True);p.add_argument("--review",required=True);p.add_argument("--previews",required=True)
    args=parser.parse_args()
    try:
        if args.command=="init":
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}",args.pet_id): raise ValueError("Use a safe lowercase pet ID")
            color(args.key);run=Path(args.run).resolve()
            if (run/"brief.json").exists(): raise ValueError("Run already exists; preserve the previous brief")
            for name in ("references","sources","frames","qa","previews","final"): (run/name).mkdir(parents=True,exist_ok=True)
            result={"pet_id":args.pet_id,"name":args.name,"description":args.description,"version":args.version,"chroma_key":args.key,
                    "reference_paths":[],"style":"User request; not yet approved","states":[s for s,_,_ in state_specs(args.version)]}
            write_json(run/"brief.json",result)
        elif args.command=="extract": result=extract(args)
        elif args.command=="assemble": result=assemble(args)
        elif args.command=="validate":
            result=validate_image(args.image,args.key);write_json(args.report,result)
        elif args.command=="previews": result=previews(args)
        elif args.command=="retime": result=retime(args)
        else: result=release(args)
        print(json.dumps({k:v for k,v in result.items() if k!="cells"},ensure_ascii=False,indent=2))
        if result.get("ok") is False: raise SystemExit(1)
    except (ValueError,OSError,KeyError) as exc:
        parser.exit(1,f"ERROR: {exc}\n")


if __name__=="__main__": main()
