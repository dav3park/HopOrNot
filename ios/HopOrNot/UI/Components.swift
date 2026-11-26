import SwiftUI
import UIKit

// MARK: 상단바와 버튼 (시스템 내비게이션 바를 쓰지 않는다)

struct RoundIconButton<Glyph: View>: View {
    let label: String
    let action: () -> Void
    @ViewBuilder var glyph: Glyph

    var body: some View {
        Button(action: action) {
            glyph
                .frame(width: 42, height: 42)
                .background(Brand.card, in: Circle())
                .overlay(Circle().stroke(Brand.line, lineWidth: 1))
                .shadow(color: Brand.ink.opacity(0.06), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// 뒤로가기 화살표 (둥근 끝의 두꺼운 선)
struct BackGlyph: View {
    var body: some View {
        Path { p in
            p.move(to: CGPoint(x: 12, y: 3)); p.addLine(to: CGPoint(x: 4, y: 11)); p.addLine(to: CGPoint(x: 12, y: 19))
        }
        .stroke(Brand.ink, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
        .frame(width: 16, height: 22)
    }
}

/// 설정 아이콘: 슬라이더 세 줄
struct SlidersGlyph: View {
    var body: some View {
        Canvas { ctx, size in
            for (i, knob) in [0.7, 0.3, 0.6].enumerated() {
                let y = 4.0 + Double(i) * 7
                ctx.stroke(Path { p in p.move(to: CGPoint(x: 1, y: y)); p.addLine(to: CGPoint(x: 19, y: y)) },
                           with: .color(Brand.ink), style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
                ctx.fill(Path(ellipseIn: CGRect(x: 1 + knob * 16 - 3, y: y - 3, width: 6, height: 6)), with: .color(Brand.card))
                ctx.stroke(Path(ellipseIn: CGRect(x: 1 + knob * 16 - 3, y: y - 3, width: 6, height: 6)), with: .color(Brand.ink), lineWidth: 2)
            }
        }
        .frame(width: 20, height: 18)
    }
}

/// 화면 맨 위: 왼쪽 뒤로가기, 가운데 제목, 오른쪽 버튼들
struct TopBar<Center: View, Trailing: View>: View {
    var onBack: (() -> Void)?
    @ViewBuilder var center: Center
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 10) {
            if let onBack { RoundIconButton(label: "뒤로", action: onBack) { BackGlyph() } } else { Color.clear.frame(width: 42, height: 42) }
            Spacer(minLength: 0)
            center
            Spacer(minLength: 0)
            trailing.frame(minWidth: 42, minHeight: 42)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
    }
}

// MARK: 알약 선택기 (시스템 세그먼트 대신)

struct PillPicker<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value
    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.0) { value, title in
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { selection = value }
                } label: {
                    Text(title)
                        .font(Brand.body(14, .bold))
                        .foregroundStyle(selection == value ? .white : Brand.inkSoft)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background {
                            if selection == value {
                                Capsule().fill(Brand.ink).matchedGeometryEffect(id: "pill", in: namespace)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Brand.chip, in: Capsule())
    }
}

// MARK: 뒤로 밀기 제스처 (상단바를 숨겨도 되살린다)

extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}
