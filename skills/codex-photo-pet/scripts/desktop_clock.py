"""Optional intrinsic-clock WebP tooling for a verified local CSS sprite client."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess

from PIL import Image, ImageChops, ImageStat
from pet_assets import (CW, CH, COLS, MAX_BYTES, SPECS, state_specs, validate_image,
                        read_json, write_json, digest, configure_console)
from target_state import inspect_target, require_intrinsic_runtime


def visible(image):
    canvas=Image.new("RGBA",image.size,"#20242b")
    canvas.alpha_composite(image)
    return canvas.convert("RGB")


def equivalent(first,second):
    if first.getchannel("A").tobytes()!=second.getchannel("A").tobytes(): return False
    difference=ImageChops.difference(visible(first),visible(second))
    return max(high for low,high in difference.getextrema())<=1


def timeline_frame(source,rows,poses,time):
    frame=source.copy()
    # Copying the static source preserves all distinct v2 gaze cells.
    for record,row_poses in zip(rows,poses):
        source_time=((time%record["cycle_ms"])/record["cycle_ms"])*sum(record["durations"])
        accumulated=0;selected=len(row_poses)-1
        for pose,duration in enumerate(record["durations"]):
            accumulated+=duration
            if source_time<accumulated:
                selected=pose;break
        for column in range(len(row_poses)):
            frame.paste(row_poses[selected],(column*CW,record["row"]*CH))
    return frame


def build(args):
    import imageio_ffmpeg
    runtime=read_json(args.runtime)
    pet_id=runtime.get("pet_id")
    if not isinstance(pet_id,str): raise ValueError("Runtime must identify the local pet folder")
    require_intrinsic_runtime(runtime,pet_id,digest(args.image),inspect_target(runtime.get("codex_home"),pet_id))
    structural=validate_image(args.image)
    if not structural["ok"]: raise ValueError("The source must be a valid static master")
    if not .1<=args.speed<=3 or not 1<=args.fps<=60: raise ValueError("Invalid speed/fps")
    if not 0<args.idle_multiplier<=100: raise ValueError("Idle multiplier must be positive and verified against the target client")
    if args.period_ms<=0 or args.period_ms*args.fps%1000: raise ValueError("Period must contain an integer number of encoded frames")
    if args.period_ms*args.fps//1000>1000: raise ValueError("Timeline exceeds the bounded 1000-frame export limit; choose a shorter period/fps")
    source=Image.open(args.image).convert("RGBA")
    poses=[];rows=[]
    for row,(state,count,times) in enumerate(SPECS):
        poses.append([source.crop((c*CW,row*CH,(c+1)*CW,(row+1)*CH)) for c in range(count)])
        native=sum(times)*(args.idle_multiplier if state=="idle" else 1)
        repeats=max(1,round(args.period_ms/(native/args.speed)))
        cycle=args.period_ms/repeats
        if abs(native/cycle-args.speed)/args.speed>.15:
            raise ValueError(f"Loop period cannot represent the requested {state} speed within 15%; choose a longer period")
        if min(times)/sum(times)*cycle < 1000/args.fps:
            raise ValueError(f"Sampling would skip {state} poses; increase fps or lower speed")
        rows.append({"state":state,"row":row,"durations":times,"repeats":repeats,
                     "cycle_ms":cycle,"native_cycle_ms":native,"effective_speed":native/cycle})
    output=Path(args.output).resolve()
    if output.exists(): raise ValueError("Output exists; choose a new revision filename")
    output.parent.mkdir(parents=True,exist_ok=True)
    command=[imageio_ffmpeg.get_ffmpeg_exe(),"-y","-v","error","-f","rawvideo","-pixel_format","rgba",
             "-video_size",f"{source.width}x{source.height}","-framerate",str(args.fps),"-i","pipe:0",
             "-an","-c:v","libwebp_anim","-lossless","1","-compression_level","6","-loop","0",str(output)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    count=args.period_ms*args.fps//1000
    try:
        for index in range(count):
            time=index*1000/args.fps
            frame=timeline_frame(source,rows,poses,time)
            process.stdin.write(frame.tobytes())
            if index%max(1,count//4)==0: print(f"Timeline {index}/{count}",flush=True)
    finally:
        process.stdin.close()
    error=process.stderr.read().decode("utf-8",errors="replace")
    if process.wait()!=0: raise ValueError(error)
    if output.stat().st_size>MAX_BYTES: raise ValueError("Encoded output exceeds 20 MiB; do not install")
    with Image.open(output) as image:
        if not image.is_animated: raise ValueError("Encoder did not produce animation")
        frames=image.n_frames
    report={"image":str(output),"image_sha256":digest(output),"source":str(Path(args.image).resolve()),
            "source_sha256":structural["sha256"],"version":structural["version"],"speed":args.speed,
            "period_ms":args.period_ms,"fps":args.fps,"rows":rows,"frames":frames,
            "encoded_bytes":output.stat().st_size,"playback_verified":False}
    write_json(args.report,report)
    return report


def verify(args):
    source_check=validate_image(args.source)
    if not source_check["ok"]: raise ValueError("Invalid static source")
    source=Image.open(args.source).convert("RGBA")
    allowed=[]
    for row,(state,count,_) in enumerate(SPECS):
        allowed.append([source.crop((c*CW,row*CH,(c+1)*CW,(row+1)*CH)) for c in range(count)])
    encoding=read_json(args.encoding)
    if encoding.get("image_sha256")!=digest(args.image) or encoding.get("source_sha256")!=digest(args.source):
        raise ValueError("Image/source changed since encoding")
    errors=[];duration=0;observed=[set() for _ in SPECS]
    with Image.open(args.image) as image:
        if image.size!=source.size or not image.is_animated: errors.append("Shape/animation mismatch")
        for index in range(image.n_frames):
            image.seek(index);frame=image.convert("RGBA");duration+=image.info.get("duration",0)
            for row,(state,count,_) in enumerate(SPECS):
                first=frame.crop((0,row*CH,CW,(row+1)*CH))
                matches=[i for i,reference in enumerate(allowed[row]) if equivalent(first,reference)]
                if not matches: errors.append(f"Unknown visible artwork at time {index}, row {row}")
                else: observed[row].update(matches)
                for column in range(1,count):
                    cell=frame.crop((column*CW,row*CH,(column+1)*CW,(row+1)*CH))
                    if not equivalent(first,cell): errors.append(f"Visible column mismatch {index}/{row}/{column}")
                if count<8 and frame.crop((count*CW,row*CH,8*CW,(row+1)*CH)).getchannel("A").getbbox():
                    errors.append(f"Opaque unused cell at {index}/{row}")
            if source_check["version"]==2:
                for row in (9,10):
                    for column in range(8):
                        box=(column*CW,row*CH,(column+1)*CW,(row+1)*CH)
                        if not equivalent(frame.crop(box),source.crop(box)): errors.append(f"Changed gaze cell {index}/{row}/{column}")
        frames=image.n_frames
    for row,indices in enumerate(observed):
        if len(indices)!=len(allowed[row]): errors.append(f"Missing temporal source phases in row {row}")
    if duration!=encoding["period_ms"]: errors.append("Encoded loop duration mismatch")
    browser_dir=Path(args.browser_qa).resolve();browser=read_json(browser_dir/"samples.json")
    if browser.get("image_sha256")!=digest(args.image): errors.append("Browser inspected a different image")
    if browser.get("reduced_motion") is not False: errors.append("Reduced-motion preference blocks intrinsic animation")
    if browser.get("rows")!=source.height//CH: errors.append("Browser used the wrong atlas geometry")
    references=[visible(frame) for frame in allowed[3]]
    classified=[]
    for sample in browser["samples"]:
        sample_path=(browser_dir/sample["file"]).resolve()
        if not sample_path.is_relative_to(browser_dir) or digest(sample_path)!=sample.get("sha256"):
            raise ValueError("Browser screenshot changed after capture or escapes its QA directory")
        with Image.open(sample_path) as opened: screenshot=opened.convert("RGB")
        scores=[sum(ImageStat.Stat(ImageChops.difference(screenshot,ref)).mean)/3 for ref in references]
        best=min(range(4),key=scores.__getitem__)
        classified.append({**sample,"pose":best,"mean_visible_error":scores[best]})
    rises=[];was_up=False
    for sample in classified:
        up=sample["pose"] in (1,2)
        if up and not was_up: rises.append(sample["time"])
        was_up=up
    periods=[b-a for a,b in zip(rises,rises[1:])]
    measured=statistics.median(periods) if periods else None
    expected=encoding["rows"][3]["cycle_ms"]
    native=sum(browser["durations"])
    if measured is None or abs(measured-expected)>max(180,expected*.18): errors.append("Measured gesture period does not match the requested clock")
    if encoding["speed"]<1 and measured is not None and measured<=native*1.1: errors.append("Browser playback is not measurably slower")
    if max(s["mean_visible_error"] for s in classified)>3: errors.append("Browser screenshot does not match the approved source poses")
    if len({s["column"] for s in classified})<2: errors.append("Probe did not exercise native column changes")
    if Path(args.image).stat().st_size>MAX_BYTES: errors.append("Image exceeds 20 MiB")
    report={"ok":not errors,"errors":errors,"image":str(Path(args.image).resolve()),"image_sha256":digest(args.image),
            "source_sha256":digest(args.source),"version":source_check["version"],"all_temporal_frames_checked":True,
            "frames":frames,"period_ms":duration,"observed_source_indices":[sorted(s) for s in observed],
            "browser_measured_period_ms":measured,"browser_measured_speed":native/measured if measured else None,
            "browser_qa":str(browser_dir),"browser_samples_sha256":digest(browser_dir/"samples.json")}
    write_json(args.report,report)
    return report


def playback_release(args):
    from install_pet import check_release
    static=check_release(args.static_release);validation=read_json(args.validation);runtime=read_json(args.runtime)
    if static.get("kind")!="static" or digest(static["image"])!=static["image_sha256"]: raise ValueError("Stale/nonstatic source release")
    if validation.get("ok") is not True or validation.get("all_temporal_frames_checked") is not True or validation.get("source_sha256")!=static["image_sha256"] or validation.get("image_sha256")!=digest(args.image):
        raise ValueError("Temporal validation does not bind these source/output bytes")
    browser_dir=Path(validation["browser_qa"]).resolve()
    if digest(browser_dir/"samples.json")!=validation["browser_samples_sha256"]:
        raise ValueError("Browser evidence changed after temporal validation")
    for sample in read_json(browser_dir/"samples.json")["samples"]:
        sample_path=(browser_dir/sample["file"]).resolve()
        if not sample_path.is_relative_to(browser_dir) or digest(sample_path)!=sample.get("sha256"):
            raise ValueError("Browser screenshot is missing, stale or outside the QA directory")
    require_intrinsic_runtime(runtime,static["pet_id"],static["image_sha256"],
                              inspect_target(runtime.get("codex_home"),static["pet_id"]))
    result={**static,"kind":"playback","image":str(Path(args.image).resolve()),"image_sha256":digest(args.image),
            "static_release":str(Path(args.static_release).resolve()),"static_release_sha256":digest(args.static_release),
            "temporal_validation":str(Path(args.validation).resolve()),"temporal_validation_sha256":digest(args.validation),
            "runtime":str(Path(args.runtime).resolve()),"runtime_sha256":digest(args.runtime),
            "limitations":static.get("limitations",[])+["Independent image clock does not provide native pause or exact state-entry synchronization."]}
    write_json(args.output,result)
    return {"release":str(Path(args.output).resolve()),"image_sha256":result["image_sha256"]}


def main():
    configure_console()
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("build");p.add_argument("--image",required=True);p.add_argument("--output",required=True);p.add_argument("--report",required=True);p.add_argument("--runtime",required=True);p.add_argument("--speed",type=float,default=.65);p.add_argument("--idle-multiplier",type=float,required=True);p.add_argument("--period-ms",type=int,default=20800);p.add_argument("--fps",type=int,default=10)
    p=sub.add_parser("verify");p.add_argument("--image",required=True);p.add_argument("--source",required=True);p.add_argument("--encoding",required=True);p.add_argument("--browser-qa",required=True);p.add_argument("--report",required=True)
    p=sub.add_parser("release");p.add_argument("--static-release",required=True);p.add_argument("--image",required=True);p.add_argument("--validation",required=True);p.add_argument("--runtime",required=True);p.add_argument("--output",required=True)
    args=parser.parse_args()
    try:
        result={"build":build,"verify":verify,"release":playback_release}[args.command](args)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        if result.get("ok") is False: raise SystemExit(1)
    except (ValueError,OSError,KeyError) as exc: parser.exit(1,f"ERROR: {exc}\n")


if __name__=="__main__": main()
