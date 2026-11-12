"""Refresh three static routes from the public GBIS map (no service key).

Only route geometry/stops are retained. Vehicle/plate/live data is not stored.
GBIS's public map response is EPSG:3857; convert to WGS84 for Kakao Maps.
"""
import argparse
import datetime
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

ENDPOINT = "https://www.gbis.go.kr/gbis2014/schBusAPI.action"
ROUTES = {"5100": "200000115", "1112": "234000016", "M5107": "234001243"}


def coordinate(row):
    longitude = float(row["lon"]) / 6378137 * 180 / math.pi
    latitude = math.degrees(math.atan(math.sinh(float(row["lat"]) / 6378137)))
    if not (124 < longitude < 132 and 33 < latitude < 40):
        raise ValueError("GBIS coordinate outside Korea")
    return {"latitude": round(latitude, 7), "longitude": round(longitude, 7)}


def read_response(route_id, command, cache):
    if cache:
        raw = (cache / ("gbis-" + route_id + "-" + command + ".json")).read_bytes()
    else:
        data = urllib.parse.urlencode({"cmd": command, "routeId": route_id}).encode()
        request = urllib.request.Request(ENDPOINT, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read()
    result = json.loads(raw)
    if result.get("success") is not True:
        raise ValueError("GBIS did not return route data")
    return result["result"]["gg"]


def build_route(name, route_id, cache):
    route = read_response(route_id, "searchRouteJson", cache)
    lines = read_response(route_id, "searchMapLineJson", cache)
    directions = {}
    for direction, side in [("TO_SEOUL", "up"), ("TO_CAMPUS", "down")]:
        stations = []
        for row in route[side]["list"]:
            # Type 6 is a pass-through point, not a place to board.
            if str(row["stationTp"]) == "6":
                continue
            stations.append({"stationId": row["stationId"], "name": row["stationNm"], "sequence": int(row["estiSeq"]), **coordinate(row)})
        stations.sort(key=lambda station: station["sequence"])
        # Match GBIS's own map renderer: type 2 is link metadata, not shape vertices.
        vertices = [coordinate(row) for row in lines[side + "Line"]["list"] if str(row["type"]) != "2"]
        if len(vertices) < 2 or not stations:
            raise ValueError("Missing official geometry or boarding stations")
        directions[direction] = {"stations": stations, "path": [vertices]}
    turn = directions["TO_SEOUL"]["stations"][-1]
    returning = directions["TO_CAMPUS"]["stations"]
    if not any(stop["stationId"] == turn["stationId"] for stop in returning):
        returning.insert(0, turn.copy())
    return {"routeId": route_id, "name": name, "directions": directions}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cached-responses", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "src/data/gbis/routes.json")
    args = parser.parse_args()
    catalog = {"source": "경기버스정보(GBIS) 공개 노선 지도", "sourceUrl": "https://www.gbis.go.kr/gbis2014/schBus.action", "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "coordinateSystem": "WGS84", "routes": [build_route(name, route_id, args.cached_responses) for name, route_id in ROUTES.items()]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(".tmp")
    temp.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(args.output)
    for route in catalog["routes"]:
        print(route["name"], route["routeId"], {d: {"stops": len(v["stations"]), "vertices": sum(map(len, v["path"]))} for d, v in route["directions"].items()})


if __name__ == "__main__":
    main()
