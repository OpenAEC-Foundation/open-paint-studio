# Raster images in IFCX and IfcImageB

Export **IFCX (raster)** or **IfcImageB** from the ribbon's Export menu or the File screen. The complete visible canvas is rendered to a PNG with its background/alpha, then embedded in the file. The drawing in Paint Studio remains editable; the exported payload is a raster snapshot.

The JSON document uses the IFCX alpha envelope (`header.ifcxVersion: ifcx_alpha`, `imports`, `schemas`, `data`). One node at `/paint/image` carries the inline, object-valued `openaec::paint::rasterImage` attribute:

```json
{
  "version": 1,
  "name": "Image name",
  "width": 1200,
  "height": 800,
  "mimeType": "image/png",
  "uri": "data:image/png;base64,..."
}
```

Width and height are pixels. All image bytes are embedded; there are no external file references. Consumers must understand this OpenAEC raster attribute to display the image. It is an image resource, with no model placement or physical scale assigned.

## IfcImageB

IfcImageB (`.ifcimageb`, `application/x-ifcimageb`) is the binary form: it encodes the same JSON values as ordinary CBOR, prefixed with self-described-CBOR tag 55799 and compressed with gzip. This follows the generic IFCX CBOR/gzip transport used by [Open BIM Studio's reference writer](https://github.com/OpenAEC-Foundation/open-bim-studio/blob/main/spikes/dynlex-bim-slice/overlay/examples/bim-slice/bim_ifcx_binary.dl). It uses no string-reference or decimal tags. IFCXB encodings vary between applications; this transport is separate from IFCCAD's experimental typed-CBOR/Zstd format.

IfcImageB is the former **IFCXB (raster)** export under its own name and extension; the bytes are unchanged, so `.ifcxb` raster files from earlier releases still open. Both editions read and write it: the browser and desktop edition through `shared/ifcx.ts`, the native DynLex edition through its own CBOR, base64 and gzip code (`dynlex/paint/ifcimage.dl`). Files written by either open in the other. Writers keep to the reader's limits: at most 4096 pixels a side and 8 megapixels, 64 MB in all.

Use **File → Open IFCX** to reopen these IFCX and IfcImageB raster files in Paint Studio. The reader requires one raster, checks PNG dimensions against metadata, and bounds compressed and decompressed input to 64 MB. Canvas/image limits also apply. Save/Ctrl+S writes IFCX with an embedded raster image. Editable scene operations remain available in the local draft; SVG exports vector geometry.
