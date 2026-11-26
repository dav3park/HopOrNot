import SwiftUI

/// 버스 행선지 전광판 같은 5×7 도트 글자 (HOP OR NOT 에 필요한 글자만)
enum LEDFont {
    static let glyphs: [Character: [String]] = [
        "H": ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
        "O": [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
        "P": ["XXXX.", "X...X", "X...X", "XXXX.", "X....", "X....", "X...."],
        "R": ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
        "N": ["X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X", "X...X"],
        "T": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
        " ": ["...", "...", "...", "...", "...", "...", "..."],
    ]

    /// 글자 사이에 빈 열 하나. 행 7칸짜리 열 목록
    static func columns(_ text: String) -> [[Bool]] {
        var result: [[Bool]] = []
        for (index, character) in text.enumerated() {
            let rows = glyphs[character] ?? glyphs[" "]!
            for c in 0..<rows[0].count { result.append(rows.map { Array($0)[c] == "X" }) }
            if index < text.count - 1 { result.append([Bool](repeating: false, count: 7)) }
        }
        return result
    }
}

/// 전광판: progress(0…1)만큼 왼쪽부터 켜진다. 켜진 도트는 호박색으로 번진다.
struct LEDBoard: View {
    let text: String
    var progress: Double = 1
    var tint: Color = Brand.led

    private var columns: [[Bool]] { LEDFont.columns(text) }

    var body: some View {
        let columns = self.columns
        Canvas { ctx, size in
            let pitch = size.width / Double(columns.count)
            let radius = pitch * 0.36
            let reach = progress * Double(columns.count + 4)   // 빛이 지나가는 앞머리
            func center(_ c: Int, _ r: Int) -> CGPoint { CGPoint(x: (Double(c) + 0.5) * pitch, y: (Double(r) + 0.5) * pitch) }
            func dot(_ p: CGPoint, _ rad: Double) -> Path { Path(ellipseIn: CGRect(x: p.x - rad, y: p.y - rad, width: rad * 2, height: rad * 2)) }

            // 꺼진 도트 (전광판 바탕)
            for c in 0..<columns.count { for r in 0..<7 { ctx.fill(dot(center(c, r), radius * 0.8), with: .color(Brand.ledDim)) } }

            // 켜진 도트: 번짐 → 선명한 도트 → 앞머리는 더 밝게
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: pitch * 0.7))
                for c in 0..<columns.count where Double(c) < reach {
                    for r in 0..<7 where columns[c][r] { layer.fill(dot(center(c, r), radius * 1.5), with: .color(tint.opacity(0.7))) }
                }
            }
            for c in 0..<columns.count where Double(c) < reach {
                let fresh = reach - Double(c) < 2.5
                for r in 0..<7 where columns[c][r] {
                    ctx.fill(dot(center(c, r), radius), with: .color(fresh ? Color(hex: 0xFFE2A0) : tint))
                }
            }
        }
        .aspectRatio(Double(columns.count) / 7, contentMode: .fit)
        .accessibilityLabel(text)
    }
}
