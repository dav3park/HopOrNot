import SwiftUI

/// 탈 확률 높은 정류장: 같은 노선·방향의 가까운 승차 정류장을 "다음 버스에 내가 탈 확률" 순으로.
/// 버스보다 먼저 걸어갈 수 있는 곳을 위에 둔다 (ml/src/live.py recommend).
struct RecommendCard: View {
    let route: Route
    let recommendation: Recommendation
    var onSelect: (Int) -> Void

    private var rows: [Candidate] { Array(recommendation.candidates.prefix(5)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("탈 확률 높은 정류장")
                .font(.system(size: 17, weight: .bold))
            Text("지금 그 정류장에 있다면, 다음 버스 기준")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)

            ForEach(Array(rows.enumerated()), id: \.element.id) { index, candidate in
                if index > 0 { Divider() }
                if candidate.isMine {
                    row(candidate, rank: index + 1)
                } else {
                    Button { onSelect(candidate.stationSeq) } label: { row(candidate, rank: index + 1) }
                        .buttonStyle(.plain)
                }
            }
        }
        .card()
    }

    private func row(_ c: Candidate, rank: Int) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(rank == 1 && c.reachable ? .white : .secondary)
                .frame(width: 22, height: 22)
                .background(rank == 1 && c.reachable ? Theme.accent : Color(.tertiarySystemFill), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(c.stationName)
                        .font(.system(size: 14, weight: c.isMine ? .heavy : .semibold))
                        .foregroundStyle(c.isMine ? Theme.route(route) : .primary)
                        .lineLimit(1)
                    if c.isMine {
                        Text("내 정류장")
                            .font(.system(size: 9.5, weight: .bold))
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .foregroundStyle(.white)
                            .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 4))
                    }
                }
                Text(subtitle(c))
                    .font(.system(size: 11.5))
                    .foregroundStyle(c.reachable ? Color.secondary : Color(hex: 0xB4570A))
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(Format.percent(c.mySeat))
                .font(.system(size: 17, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(c.reachable ? Theme.text(c.mySeat) : .secondary)
            if !c.isMine {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private func subtitle(_ c: Candidate) -> String {
        if c.isMine { return "다음 버스 약 \(c.busEtaMinutes)분 후" }
        let way = c.stopsFromMine < 0 ? "\(-c.stopsFromMine)정거장 거슬러" : "\(c.stopsFromMine)정거장 앞"
        let walk = "\(way) · 도보 \(c.walkMinutes)분"
        return c.reachable ? walk : "\(walk) · 버스가 먼저 옴"
    }
}
