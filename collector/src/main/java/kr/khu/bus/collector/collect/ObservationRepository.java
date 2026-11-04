package kr.khu.bus.collector.collect;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ObservationRepository {

    private final JdbcTemplate jdbc;

    public ObservationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 버스위치정보 응답의 차량 목록을 한 번에 저장. */
    public void insertObservations(OffsetDateTime collectedAt, LocalDateTime queryTime, long routeId,
                                   List<JsonNode> buses) {
        if (buses.isEmpty()) {
            return;
        }
        jdbc.batchUpdate("""
                INSERT INTO bus_observation
                  (collected_at, query_time, route_id, veh_id, plate_no, station_id, station_seq,
                   state_cd, remain_seat_cnt, crowded, low_plate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, buses, buses.size(), (ps, b) -> {
            ps.setObject(1, collectedAt);
            if (queryTime == null) ps.setNull(2, Types.TIMESTAMP); else ps.setObject(2, queryTime);
            ps.setLong(3, routeId);
            setLong(ps, 4, b, "vehId");
            setText(ps, 5, b, "plateNo");
            setLong(ps, 6, b, "stationId");
            setInt(ps, 7, b, "stationSeq");
            setInt(ps, 8, b, "stateCd");
            setInt(ps, 9, b, "remainSeatCnt");
            setInt(ps, 10, b, "crowded");
            setInt(ps, 11, b, "lowPlate");
        });
    }

    public void insertRaw(OffsetDateTime collectedAt, String api, long routeId, String body) {
        jdbc.update("INSERT INTO raw_response (collected_at, api, route_id, body) VALUES (?, ?, ?, ?::jsonb)",
                collectedAt, api, routeId, body);
    }

    public int countStations(long routeId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM route_station WHERE route_id = ?", Integer.class, routeId);
        return n == null ? 0 : n;
    }

    public void insertStations(long routeId, List<JsonNode> stations) {
        jdbc.batchUpdate("""
                INSERT INTO route_station
                  (route_id, station_seq, station_id, station_name, mobile_no, region_name,
                   center_yn, turn_yn, x, y)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (route_id, station_seq) DO NOTHING
                """, stations, stations.size(), (ps, s) -> {
            ps.setLong(1, routeId);
            setInt(ps, 2, s, "stationSeq");
            setLong(ps, 3, s, "stationId");
            setText(ps, 4, s, "stationName");
            setText(ps, 5, s, "mobileNo");
            setText(ps, 6, s, "regionName");
            setText(ps, 7, s, "centerYn");
            setText(ps, 8, s, "turnYn");
            setDouble(ps, 9, s, "x");
            setDouble(ps, 10, s, "y");
        });
    }

    private static boolean absent(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() || (v.isTextual() && v.asText().isBlank());
    }

    private static void setInt(PreparedStatement ps, int i, JsonNode n, String f) throws SQLException {
        if (absent(n, f)) ps.setNull(i, Types.INTEGER); else ps.setInt(i, n.get(f).asInt());
    }

    private static void setLong(PreparedStatement ps, int i, JsonNode n, String f) throws SQLException {
        if (absent(n, f)) ps.setNull(i, Types.BIGINT); else ps.setLong(i, n.get(f).asLong());
    }

    private static void setDouble(PreparedStatement ps, int i, JsonNode n, String f) throws SQLException {
        if (absent(n, f)) ps.setNull(i, Types.DOUBLE); else ps.setDouble(i, n.get(f).asDouble());
    }

    private static void setText(PreparedStatement ps, int i, JsonNode n, String f) throws SQLException {
        if (absent(n, f)) ps.setNull(i, Types.VARCHAR); else ps.setString(i, n.get(f).asText());
    }
}
