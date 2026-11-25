import MapKit
import SwiftUI

/// 지도: 노선 전체(경기버스 공식 도로 경로, 고속도로는 회색)와 모든 정류장, 내 정류장으로 오는 버스는 큰 핀.
/// 버스 위치는 GPS가 아니라 버스가 지난 정류장 기준이다 (도착해 있으면 그 정류장, 가는 중이면 다음 정류장까지 도로의 중간).
struct BusMapView: View {
    let route: Route
    let stops: [RouteStop]
    let segments: [PathSegment]
    let otherBuses: [RouteBus]     // 노선 위 모든 버스
    let line: LineView             // 내 정류장으로 오는 버스
    let prediction: Prediction?
    let recommendedOrder: Int?
    let mySeq: Int

    @State private var position: MapCameraPosition = .automatic
    @State private var showWholeRoute = false
    @State private var latitudeDelta = 0.05

    private var coming: [LineBus] { Array(line.buses.prefix(4)) }
    private var comingIDs: Set<Int> { Set(coming.map(\.vehId)) }

    var body: some View {
        Map(position: $position) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                MapPolyline(coordinates: segment.points.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) })
                    .stroke(segment.isHighway ? Theme.highway : Theme.route(route).opacity(0.85), lineWidth: 5)
            }

            // 모든 정류장 (확대하면 이름)
            ForEach(stops) { stop in
                Annotation(label(for: stop), coordinate: coordinate(stop.lat, stop.lon), anchor: .center) {
                    stopMarker(stop)
                }
            }

            // 노선 위 다른 버스: 작은 점
            ForEach(otherBuses.filter { !comingIDs.contains($0.vehId) }) { bus in
                Annotation("", coordinate: coordinate(bus.lat, bus.lon), anchor: .center) {
                    Image(systemName: "bus.fill")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 16, height: 16)
                        .background(Theme.route(route).opacity(0.6), in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 1.5))
                }
            }

            // 내 정류장으로 오는 버스: 큰 핀 (먼 버스가 아래로 가도록 순서 역순)
            ForEach(coming.reversed()) { bus in
                Annotation("", coordinate: coordinate(bus.lat, bus.lon), anchor: .bottom) {
                    busPin(bus).offset(y: -stackOffset(for: bus))
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onMapCameraChange(frequency: .onEnd) { context in latitudeDelta = context.region.span.latitudeDelta }
        .overlay(alignment: .topTrailing) {
            Button {
                showWholeRoute.toggle()
                withAnimation { position = .region(showWholeRoute ? wholeRegion : focusRegion) }
            } label: {
                Label(showWholeRoute ? "버스 보기" : "전체 노선", systemImage: showWholeRoute ? "scope" : "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
            }
            .buttonStyle(.plain)
            .padding(8)
        }
        .onAppear { position = .region(focusRegion) }
        .onChange(of: line.stationSeq) { showWholeRoute = false; position = .region(focusRegion) }
    }

    // MARK: 마커

    @ViewBuilder
    private func stopMarker(_ stop: RouteStop) -> some View {
        if stop.stationSeq == mySeq {
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(.white, Theme.route(route))
                .shadow(radius: 2, y: 1)
        } else if stop.isHighway {
            Circle().fill(Theme.highway).frame(width: 7, height: 7).overlay(Circle().stroke(.white, lineWidth: 1))
        } else if stop.isVia {
            Circle().fill(Theme.route(route).opacity(0.5)).frame(width: 5, height: 5)
        } else {
            Circle().fill(.white).frame(width: 10, height: 10)
                .overlay(Circle().stroke(Theme.route(route).opacity(stop.kind == "campus" ? 0.45 : 1), lineWidth: 2.5))
        }
    }

    /// 이름은 확대했을 때만 (내 정류장은 항상). 고속도로 IC 이름은 더 확대해야 보인다.
    private func label(for stop: RouteStop) -> String {
        if stop.stationSeq == mySeq { return stop.displayName }
        if stop.isHighway { return latitudeDelta < 0.05 ? stop.displayName : "" }
        if stop.isVia { return "" }
        return latitudeDelta < 0.08 ? stop.displayName : ""
    }

    /// 가까운(약 150m 안) 버스가 앞에 있으면 그 수만큼 핀을 위로 쌓아 서로 가리지 않게 한다
    private func stackOffset(for bus: LineBus) -> CGFloat {
        let earlier = coming.filter { $0.order < bus.order }
        let near = earlier.filter { other in
            let dy = (other.lat - bus.lat) * 111_000, dx = (other.lon - bus.lon) * 88_000
            return (dx * dx + dy * dy).squareRoot() < 150
        }
        return CGFloat(near.count) * 34
    }

    /// 내 정류장으로 오는 버스: 도착 순서 번호가 든 핀 + 이 버스까지 탈 확률 (번호 1 = 이번 버스)
    private func busPin(_ bus: LineBus) -> some View {
        let byHere = prediction?.mySeat?.byBus.flatMap { bus.order < $0.count ? $0[bus.order] : nil }
        let recommended = bus.order == recommendedOrder
        let ring = recommended ? Theme.accent : Theme.route(route)
        return VStack(spacing: 0) {
            HStack(spacing: 5) {
                Text("\(bus.order + 1)")
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(Theme.route(route), in: Circle())
                Text(byHere.map(Format.percent) ?? "\(bus.currentSeats)석")
                    .font(.system(size: 15, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(byHere.map(Theme.text) ?? .primary)
            }
            .padding(.leading, 4).padding(.trailing, 9).padding(.vertical, 3)
            .background(.white, in: Capsule())
            .overlay(Capsule().stroke(ring, lineWidth: recommended ? 3 : 2))
            .shadow(color: .black.opacity(0.25), radius: 3, y: 2)
            Image(systemName: "arrowtriangle.down.fill")
                .font(.system(size: 9))
                .foregroundStyle(ring)
                .offset(y: -1)
        }
    }

    // MARK: 카메라

    private func coordinate(_ lat: Double, _ lon: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private func region(_ points: [(Double, Double)], pad: Double, minSpan: Double) -> MKCoordinateRegion {
        let lats = points.map(\.0), lons = points.map(\.1)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else {
            return MKCoordinateRegion(center: coordinate(37.5665, 126.978), span: .init(latitudeDelta: 0.05, longitudeDelta: 0.05))
        }
        return MKCoordinateRegion(
            center: coordinate((minLat + maxLat) / 2, (minLon + maxLon) / 2),
            span: .init(latitudeDelta: max(minSpan, (maxLat - minLat) * pad), longitudeDelta: max(minSpan, (maxLon - minLon) * pad)))
    }

    /// 내 정류장과 오는 버스들이 모두 보이는 범위
    private var focusRegion: MKCoordinateRegion {
        let mine = stops.first { $0.stationSeq == mySeq }.map { [($0.lat, $0.lon)] } ?? []
        return region(mine + coming.map { ($0.lat, $0.lon) }, pad: 1.6, minSpan: 0.012)
    }

    private var wholeRegion: MKCoordinateRegion {
        region(stops.map { ($0.lat, $0.lon) }, pad: 1.15, minSpan: 0.05)
    }
}
