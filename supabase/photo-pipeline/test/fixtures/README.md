# test fixtures

`quadrants-96x64.heic` (596 bytes): a real HEIC (HEVC, `ftyp heic`, compatible brands `mif1 heic miaf`) of a 96x64 picture
in four flat colour quadrants (top-left red, top-right green, bottom-left blue, bottom-right yellow). It was made for this
repository from a generated image, so it has no third-party licence: a script drew the quadrants with Pillow and wrote
them with `pillow-heif` 1.8.1 (libheif 1.23.6, x265), `quality=70`. It has no EXIF and no GPS.

It is committed so the HEIC decode is tested offline. It does not stand in for a photo from a phone: no `irot` rotation,
no EXIF, no thumbnail/auxiliary images. Nothing in these tests has been run against an iPhone original.
