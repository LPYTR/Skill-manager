"""Plan, apply and roll back a verified local pet without changing active selection."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

from pet_assets import read_json, write_json, digest, validate_image, check_review, validate_previews, configure_console
from target_state import inspect_target, require_local_target, require_intrinsic_runtime


def absolute(path):
    return Path(os.path.abspath(Path(path).expanduser()))


def same_path(first,second):
    return os.path.normcase(str(absolute(first)))==os.path.normcase(str(absolute(second)))


def check_release(path):
    path=Path(path).resolve();release=read_json(path)
    image=Path(release["image"]).resolve()
    if digest(image)!=release["image_sha256"]: raise ValueError("Image changed after release")
    if release.get("kind")=="playback":
        if digest(release["static_release"])!=release["static_release_sha256"]: raise ValueError("Static release changed")
        static=check_release(release["static_release"])
        if static.get("kind")!="static": raise ValueError("Playback source must be static")
        if digest(release["temporal_validation"])!=release["temporal_validation_sha256"]: raise ValueError("Temporal report changed")
        temporal=read_json(release["temporal_validation"])
        if temporal.get("ok") is not True or temporal.get("image_sha256")!=digest(image) or temporal.get("source_sha256")!=static["image_sha256"] or temporal.get("all_temporal_frames_checked") is not True:
            raise ValueError("Temporal validation is missing, failed or stale")
        samples=Path(temporal["browser_qa"])/"samples.json"
        if digest(samples)!=temporal["browser_samples_sha256"] or read_json(samples).get("image_sha256")!=digest(image):
            raise ValueError("Browser evidence is stale")
        browser_dir=samples.parent.resolve()
        for sample in read_json(samples)["samples"]:
            sample_path=(browser_dir/sample["file"]).resolve()
            if not sample_path.is_relative_to(browser_dir) or digest(sample_path)!=sample.get("sha256"):
                raise ValueError("Browser screenshot evidence changed or escaped its QA directory")
        if digest(release["runtime"])!=release["runtime_sha256"]: raise ValueError("Runtime evidence changed")
        runtime=read_json(release["runtime"])
        require_intrinsic_runtime(runtime,release["pet_id"],static["image_sha256"],
                                  inspect_target(runtime.get("codex_home"),release["pet_id"]))
        if static["pet_id"]!=release["pet_id"]: raise ValueError("Playback release changes the pet's identity")
    elif release.get("kind")=="static":
        validation=validate_image(image,release.get("validation",{}).get("chroma_key"))
        if not validation["ok"] or validation["version"]!=release["version"]: raise ValueError("Release no longer passes format checks")
        if digest(release["review"])!=release["review_sha256"]: raise ValueError("Visual review changed after release")
        check_review(read_json(release["review"]),validation)
        preview_root=Path(release["previews"])
        if digest(preview_root/"previews.json")!=release.get("preview_manifest_sha256"):
            raise ValueError("Preview evidence changed after release")
        validate_previews(preview_root,release["image_sha256"],release["version"])
    else: raise ValueError("Unsupported release kind")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}",release["pet_id"]): raise ValueError("Unsafe local pet ID")
    return release


def plan(args):
    release=check_release(args.release)
    home=absolute(args.codex_home or os.environ.get("CODEX_HOME") or Path.home()/".codex")
    target_observation=inspect_target(home,release["pet_id"])
    local_files_only=getattr(args,"local_files_only",False)
    require_local_target(target_observation,local_files_only)
    if release.get("kind")=="playback":
        runtime=read_json(release["runtime"])
        source=check_release(release["static_release"])
        require_intrinsic_runtime(runtime,release["pet_id"],source["image_sha256"],target_observation)
    visible=home/"pets"/release["pet_id"]
    exists=os.path.lexists(visible)
    if exists and not args.update: raise ValueError("Pet already exists; inspect it, then use --update for an authorized update")
    if exists and not visible.is_dir(): raise ValueError("Existing pet path is not a valid directory")
    if args.storage: physical=(absolute(args.storage)/release["pet_id"]).resolve()
    elif exists: physical=visible.resolve()
    else: physical=visible.resolve()
    if exists and visible.resolve()!=physical: raise ValueError("Moving an existing pet to another storage root is outside this update")
    if not exists and os.path.lexists(physical): raise ValueError("Physical destination already exists; preserve its contents")
    manifest=physical/"pet.json"
    prior_hash=None
    if exists:
        if not manifest.is_file(): raise ValueError("Existing directory has no pet.json; do not overwrite")
        prior=read_json(manifest)
        if prior.get("id") not in {None,release["pet_id"]}: raise ValueError("Existing pet ID differs")
        current=(physical/prior["spritesheetPath"]).resolve()
        if not current.is_relative_to(physical): raise ValueError("Existing image escapes its pet directory")
        prior_hash=digest(manifest)
    image=Path(release["image"])
    image_name=f"spritesheet-{release['image_sha256'][:16]}{image.suffix.lower()}"
    result={"release":str(Path(args.release).resolve()),"release_sha256":digest(args.release),
            "pet_id":release["pet_id"],"visible_path":str(visible),"physical_path":str(physical),
            "update":exists,"prior_manifest_sha256":prior_hash,"link_required":not same_path(visible,physical),
            "image_name":image_name,"image_sha256":release["image_sha256"],
            "codex_home":str(home),"target_evidence":target_observation,"local_files_only":local_files_only,
            "operations":["copy verified hash-named image","create directory link if needed","atomically write pet.json","read back through Codex path"],
            "active_selection_changed":False}
    output=Path(args.output).resolve() if args.output else Path(args.release).resolve().parent/"install-plan.json"
    write_json(output,result)
    return {"plan":str(output),**result}


def create_link(visible,physical):
    visible.parent.mkdir(parents=True,exist_ok=True)
    if os.name=="nt":
        helper=Path(__file__).resolve().parent.parent/"assets/create-junction.ps1"
        subprocess.run(["powershell","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",str(helper),
                        "-LinkPath",str(visible),"-TargetPath",str(physical)],check=True,capture_output=True,text=True)
    else: visible.symlink_to(physical,target_is_directory=True)


def atomic_metadata(path,contents):
    temporary=path.with_name(f"pet.json.pending-{uuid.uuid4().hex[:10]}")
    with temporary.open("wb") as stream:
        stream.write(contents);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def apply(args):
    planned=read_json(args.plan)
    if digest(planned["release"])!=planned["release_sha256"]: raise ValueError("Release changed after planning")
    release=check_release(planned["release"])
    expected_name=f"spritesheet-{release['image_sha256'][:16]}{Path(release['image']).suffix.lower()}"
    if planned.get("pet_id")!=release["pet_id"] or planned.get("image_name")!=expected_name or planned.get("image_sha256")!=release["image_sha256"]:
        raise ValueError("Planned image/identity differs from the verified release")
    visible=absolute(planned["visible_path"]);physical=absolute(planned["physical_path"])
    home=absolute(planned.get("codex_home",visible.parent.parent))
    if absolute(home/"pets"/release["pet_id"])!=visible:
        raise ValueError("Plan's Codex home does not identify its visible pet path")
    target_observation=inspect_target(home,release["pet_id"])
    require_local_target(target_observation,planned.get("local_files_only",False))
    if release.get("kind")=="playback":
        source=check_release(release["static_release"])
        require_intrinsic_runtime(read_json(release["runtime"]),release["pet_id"],source["image_sha256"],target_observation)
    if visible.name!=release["pet_id"] or physical.name!=release["pet_id"]:
        raise ValueError("Planned directories do not preserve the pet ID")
    if physical.resolve()!=physical: raise ValueError("Physical target changed after planning")
    manifest=physical/"pet.json"
    if planned["update"]:
        if not visible.is_dir() or visible.resolve()!=physical or digest(manifest)!=planned["prior_manifest_sha256"]:
            raise ValueError("Pet changed after planning; preserve concurrent edits")
    elif os.path.lexists(visible) or os.path.lexists(physical):
        raise ValueError("A destination appeared after planning; do not overwrite it")
    prior=manifest.read_bytes() if planned["update"] else None
    current=read_json(manifest) if prior else {"id":release["pet_id"],"displayName":release["name"],"description":release.get("description","")}
    current["spritesheetPath"]=planned["image_name"]
    current["spriteVersionNumber"]=release["version"]
    payload=(json.dumps(current,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    payload_hash=__import__("hashlib").sha256(payload).hexdigest()
    physical.mkdir(parents=True,exist_ok=True)
    destination=physical/planned["image_name"]
    if destination.exists() and digest(destination)!=release["image_sha256"]: raise ValueError("Hash-named image conflicts with existing content")
    if not destination.exists(): shutil.copy2(release["image"],destination)
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"-"+uuid.uuid4().hex[:8]
    backup=physical/f"pet-backup-{stamp}.json" if prior else None
    if backup: backup.write_bytes(prior)
    if not planned["update"] and planned["link_required"]: create_link(visible,physical)
    if visible.resolve()!=physical: raise ValueError("The client path does not resolve to intended storage")
    wrote=False
    try:
        atomic_metadata(manifest,payload);wrote=True
        actual=read_json(visible/"pet.json")
        target=(visible/actual["spritesheetPath"]).resolve()
        if not target.is_relative_to(physical) or digest(target)!=release["image_sha256"] or digest(visible/"pet.json")!=payload_hash:
            raise ValueError("Installation readback failed")
    except Exception:
        if wrote and manifest.exists() and digest(manifest)==payload_hash:
            if prior: atomic_metadata(manifest,prior)
            else: manifest.unlink()
        raise
    record={"ok":True,"pet_id":release["pet_id"],"visible_path":str(visible),"physical_path":str(physical),
            "image":str(destination),"image_sha256":digest(destination),"installed_manifest_sha256":payload_hash,
            "prior_manifest":str(backup) if backup else None,"prior_manifest_sha256":planned["prior_manifest_sha256"],
            "active_selection_changed":False,"live_app_refresh_verified":False,"release":planned["release"]}
    record["target_evidence"]=target_observation
    record["local_files_only"]=planned.get("local_files_only",False)
    output=Path(args.plan).resolve().parent/f"installation-{stamp}.json"
    write_json(output,record)
    return {"record":str(output),**record}


def rollback(args):
    record=read_json(args.record);physical=absolute(record["physical_path"]);visible=absolute(record["visible_path"])
    if physical.resolve()!=physical or visible.resolve()!=physical: raise ValueError("Install paths changed; stop rollback")
    manifest=physical/"pet.json"
    if digest(manifest)!=record["installed_manifest_sha256"]: raise ValueError("Pet metadata changed since installation; preserve user/concurrent edits")
    if record.get("prior_manifest"):
        backup=Path(record["prior_manifest"]).resolve()
        if backup.parent!=physical or digest(backup)!=record["prior_manifest_sha256"]: raise ValueError("Original metadata backup changed or escaped the pet directory")
        atomic_metadata(manifest,backup.read_bytes())
    else: manifest.unlink()
    result={"ok":True,"rolled_back":record["pet_id"],"images_retained":True,"directories_retained":True,
            "metadata_restored":bool(record.get("prior_manifest"))}
    write_json(Path(args.record).with_suffix(".rollback.json"),result)
    return result


def main():
    configure_console()
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("plan");p.add_argument("--release",required=True);p.add_argument("--codex-home");p.add_argument("--storage");p.add_argument("--update",action="store_true");p.add_argument("--output");p.add_argument("--local-files-only",action="store_true",help="Only when the user explicitly requests local-file changes despite a cloud migration")
    p=sub.add_parser("apply");p.add_argument("--plan",required=True)
    p=sub.add_parser("rollback");p.add_argument("--record",required=True)
    args=parser.parse_args()
    try: print(json.dumps({"plan":plan,"apply":apply,"rollback":rollback}[args.command](args),ensure_ascii=False,indent=2))
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as exc: parser.exit(1,f"ERROR: {exc}\n")


if __name__=="__main__": main()
