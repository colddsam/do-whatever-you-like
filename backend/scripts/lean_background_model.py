"""
Makes the lighter-on-memory copy of the background-removal model (U²-Net "silueta").

silueta.onnx is dynamically quantized: every conv runs as DynamicQuantizeLinear -> ConvInteger ->
Cast -> Mul -> Add, and each step writes a full-size tensor. At the network's full 320 x 320
resolution those tensors are 25-50 MB apiece, which is where most of a run's ~240 MB goes. This
turns just the convs that run at full resolution (8 of 119, 0.6 MB of float weights) back into
plain float Conv. The runtime pairs it with ONNX Runtime's EXTENDED optimisation level (no NCHWc
layout copies), and one run then takes ~180 MB instead of ~240 MB. Masks match the original's
(IoU 0.997+ on photos); the float layers are, if anything, closer to the unquantized network.

Run once when building the Docker image; it needs the `onnx` package, which the app itself doesn't:

    python scripts/lean_background_model.py models/image/silueta.onnx models/image/silueta-lean.onnx
"""

import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper, shape_inference


def lean(src: str, dst: str) -> int:
    model = shape_inference.infer_shapes(onnx.load(src))
    g = model.graph
    side = g.input[0].type.tensor_type.shape.dim[-1].dim_value
    init = {i.name: i for i in g.initializer}
    producer = {o: n for n in g.node for o in n.output}
    consumers = {}
    for n in g.node:
        for x in n.input:
            consumers.setdefault(x, []).append(n)
    shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim] for v in g.value_info}
    array = lambda name: numpy_helper.to_array(init[name])

    replaced, dropped, weights = {}, set(), []
    for n in g.node:
        if n.op_type != "ConvInteger":
            continue
        # ConvInteger(xq, wq, x_zp, w_zp) -> Cast -> Mul(x_scale * w_scale) -> Add(bias)
        cast = consumers[n.output[0]][0]
        mul = consumers[cast.output[0]][0]
        add = consumers[mul.output[0]][0]
        if (cast.op_type, mul.op_type, add.op_type) != ("Cast", "Mul", "Add"):
            raise ValueError(f"Unexpected pattern after {n.name}")
        out = add.output[0]
        if min(shapes.get(out, [0, 0, 0, 0])[2:]) < side:
            continue
        x = producer[n.input[0]].input[0]  # the float input of DynamicQuantizeLinear
        w_scale = array(producer[mul.input[1]].input[1])
        w = (array(n.input[1]).astype(np.float32) - array(n.input[3]).astype(np.float32)) * w_scale
        b = array(producer[add.input[1]].input[0]).astype(np.float32).reshape(-1)
        weights += [numpy_helper.from_array(w.astype(np.float32), out + "_w"), numpy_helper.from_array(b, out + "_b")]
        attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        replaced[id(n)] = helper.make_node("Conv", [x, out + "_w", out + "_b"], [out], name=n.name + "_float", **attrs)
        dropped |= {id(cast), id(mul), id(add)}
    if not replaced:
        raise ValueError("No full-resolution ConvInteger found: is this silueta.onnx?")

    nodes = [replaced.get(id(n), n) for n in g.node if id(n) not in dropped]
    g.initializer.extend(weights)
    # Drop what no output depends on any more (the old quantize steps and int8 weights).
    needed, kept = {o.name for o in g.output}, []
    for n in reversed(nodes):
        if any(o in needed for o in n.output):
            kept.append(n)
            needed.update(n.input)
    del g.node[:]
    g.node.extend(reversed(kept))
    inits = [i for i in g.initializer if i.name in needed]
    del g.initializer[:]
    g.initializer.extend(inits)
    del g.value_info[:]
    onnx.checker.check_model(model)
    onnx.save(model, dst)
    return len(replaced)


if __name__ == "__main__":
    count = lean(sys.argv[1], sys.argv[2])
    print(f"{sys.argv[2]}: {count} full-resolution convs now float")
