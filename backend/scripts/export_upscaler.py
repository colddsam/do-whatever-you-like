"""
One-off: turn Real-ESRGAN's `realesr-general-x4v3.pth` (BSD-3-Clause, github.com/xinntao/Real-ESRGAN)
into the ONNX file the image tools ship with (app/assets/ml/realesr-general-x4v3.onnx), so the server
needs neither PyTorch nor a GPU.

Run it in a throwaway environment with torch + onnx installed (not the app's venv):

    pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install onnx onnxscript
    curl -L -o realesr-general-x4v3.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
    python scripts/export_upscaler.py realesr-general-x4v3.pth app/assets/ml/realesr-general-x4v3.onnx
"""

import sys

import torch
from torch import nn
from torch.nn import functional as F


class SRVGGNetCompact(nn.Module):
    """The compact Real-ESRGAN network (basicsr.archs.srvgg_arch), as used by realesr-general-x4v3."""

    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def main(src: str, dst: str) -> None:
    state = torch.load(src, map_location="cpu", weights_only=True)
    state = state.get("params_ema") or state.get("params") or state
    net = SRVGGNetCompact()
    net.load_state_dict(state, strict=True)
    net.eval()
    dummy = torch.rand(1, 3, 64, 64)
    torch.onnx.export(
        net,
        dummy,
        dst,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {2: "h", 3: "w"}, "output": {2: "h4", 3: "w4"}},
        opset_version=17,
        dynamo=False,
    )
    print("wrote", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
