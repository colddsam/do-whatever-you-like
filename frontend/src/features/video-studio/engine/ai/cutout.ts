import { EFFECTS } from "../../constants";
import { anim } from "../../lib/keyframes";
import { uid } from "../../lib/time";
import * as TL from "../../lib/timeline";
import { useStudio } from "../../store/studio-store";
import type { Effect } from "../../types";
import { mediaRuntime } from "../media";
import { aiWorker, progressLabel } from "./client";
import { loadSegmenter } from "./segmenter";
import type { Progress } from "./captions";

/**
 * "Remove background" on a clip. Video uses MediaPipe's person segmenter live, every frame. A still
 * can use RMBG-1.4 instead, which finds any subject (products, pets) but is too slow for video, so it
 * runs once and its matte is kept with the media.
 */
export async function removeBackground(clipId: string, onProgress: Progress, model: "people" | "subject" = "people") {
  const st = useStudio.getState();
  const c = st.project.clips[clipId];
  if (!c || (c.kind !== "video" && c.kind !== "image")) throw new Error("Pick a video or picture clip first.");
  const useSubject = model === "subject" && c.kind === "image";
  if (useSubject) {
    if (!mediaRuntime.masks.has(c.mediaId!)) {
      const file = mediaRuntime.file(c.mediaId!);
      if (!file) throw new Error("This picture isn't on this device any more.");
      onProgress("Finding the subject");
      const res = await aiWorker.cutout(file, (p) => {
        const pl = progressLabel(p);
        onProgress(pl.label, pl.fraction);
      });
      mediaRuntime.setMask(c.mediaId!, { data: res.mask, width: res.width, height: res.height });
    }
  } else {
    onProgress("Loading the segmenter");
    await loadSegmenter();
  }
  const effect: Effect = {
    id: uid("fx"),
    type: "bgRemoval",
    enabled: true,
    params: Object.fromEntries(EFFECTS.bgRemoval.params.map((p) => [p.key, anim(p.def)])),
    options: { model: useSubject ? "subject" : "people" },
  };
  useStudio.getState().commit((p) => TL.updateClip(p, clipId, (x) => ({ ...x, effects: [...x.effects.filter((e) => e.type !== "bgRemoval" && e.type !== "chromaKey"), effect] })));
  useStudio.getState().notify(useSubject ? "Background removed." : "Background removal is on for this clip (people).", "success");
}
