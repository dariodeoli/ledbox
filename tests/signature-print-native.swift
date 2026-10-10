import Foundation
import PDFKit
import AppKit

// Oracle de lectura: enumera TODAS las coincidencias y cajas por línea,
// incluidas las posteriores a la constancia. Nunca reescribe el PDF.
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let needlesURL = URL(fileURLWithPath: CommandLine.arguments[3])
guard let pdf = PDFDocument(url: input), pdf.pageCount > 0 else { fatalError("Invalid local PDF") }
let needles = try JSONSerialization.jsonObject(with: Data(contentsOf: needlesURL)) as! [[String: String]]
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
var pages: [[String: Any]] = []
for index in 0..<pdf.pageCount {
    guard let page = pdf.page(at: index), let text = page.string else { fatalError("Missing PDF page text") }
    let bounds = page.bounds(for: .mediaBox)
    var boxes: [[String: Any]] = []
    for needle in needles {
        let words = needle["text"]!.split(whereSeparator: { $0.isWhitespace }).map { NSRegularExpression.escapedPattern(for: String($0)) }
        let regex = try NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}])" + words.joined(separator: "\\s+") + "(?![\\p{L}\\p{N}])", options: [.caseInsensitive])
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
        for (occurrence, match) in matches.enumerated() {
            guard let selection = page.selection(for: match.range) else { continue }
            var glyphs: [[String: Any]] = []
            text.enumerateSubstrings(in: Range(match.range, in: text)!, options: .byComposedCharacterSequences) { substring, stringRange, _, _ in
                let range = NSRange(stringRange, in: text)
                guard let character = substring, !character.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      let glyph = page.selection(for: range) else { return }
                let r = glyph.bounds(for: page)
                glyphs.append(["text": character, "offset": range.location - match.range.location,
                               "left": r.minX, "top": bounds.height - r.maxY, "right": r.maxX, "bottom": bounds.height - r.minY])
            }
            for (lineIndex, line) in selection.selectionsByLine().enumerated() {
                let r = line.bounds(for: page)
                boxes.append(["key": needle["key"]!, "text": line.string ?? "", "occurrence": occurrence, "line": lineIndex,
                              "left": r.minX, "top": bounds.height - r.maxY, "right": r.maxX, "bottom": bounds.height - r.minY,
                              "width": r.width, "height": r.height,
                              "glyphs": glyphs.filter { glyph in
                                  let top = glyph["top"] as! CGFloat
                                  let bottom = glyph["bottom"] as! CGFloat
                                  return bottom > bounds.height - r.maxY && top < bounds.height - r.minY
                              }])
            }
        }
    }
    let thumbnail = page.thumbnail(of: NSSize(width: bounds.width * 2, height: bounds.height * 2), for: .mediaBox)
    guard let tiff = thumbnail.tiffRepresentation, let image = NSBitmapImageRep(data: tiff),
          let png = image.representation(using: .png, properties: [:]) else { fatalError("PDF rasterization failed") }
    try png.write(to: output.appendingPathComponent("page-\(index + 1).png"))
    pages.append(["page": index + 1, "width": bounds.width, "height": bounds.height, "text": text, "boxes": boxes])
}
let result: [String: Any] = ["pageCount": pdf.pageCount, "pages": pages, "source": "Native PDFKit text geometry and rasterized pages; read only"]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("geometry.json"))
