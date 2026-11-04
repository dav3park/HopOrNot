package kr.khu.bus.collector.gbis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.List;

/**
 * 경기도 v2 응답 해석.
 *  정상: {"response":{"msgHeader":{"resultCode":0,...},"msgBody":{"<listField>":[...]}}}
 *  결과 없음: resultCode 4 (예: 운행 중인 차량 없음)
 *  키 오류: {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":...}}}
 */
public record GbisResponse(int resultCode, String message, LocalDateTime queryTime, List<JsonNode> items) {

    public static final int OK = 0;
    public static final int NO_RESULT = 4;
    public static final int GATEWAY_ERROR = -1;

    private static final DateTimeFormatter QUERY_TIME = new DateTimeFormatterBuilder()
            .appendPattern("yyyy-MM-dd HH:mm:ss")
            .optionalStart()
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
            .optionalEnd()
            .toFormatter();

    public boolean ok() {
        return resultCode == OK || resultCode == NO_RESULT;
    }

    public static GbisResponse parse(ObjectMapper mapper, String body, String listField) throws Exception {
        JsonNode root = mapper.readTree(body);

        JsonNode gateway = root.path("OpenAPI_ServiceResponse").path("cmmMsgHeader");
        if (!gateway.isMissingNode()) {
            String msg = gateway.path("errMsg").asText("") + " / " + gateway.path("returnAuthMsg").asText("");
            return new GbisResponse(GATEWAY_ERROR, msg, null, List.of());
        }

        JsonNode header = root.path("response").path("msgHeader");
        int code = header.path("resultCode").asInt(GATEWAY_ERROR);
        String message = header.path("resultMessage").asText("");
        LocalDateTime queryTime = parseQueryTime(header.path("queryTime").asText(null));

        List<JsonNode> items = new ArrayList<>();
        JsonNode list = root.path("response").path("msgBody").path(listField);
        if (list.isArray()) {
            list.forEach(items::add);
        } else if (list.isObject()) {
            items.add(list); // 항목이 하나일 때 객체로 오는 경우 대비
        }
        return new GbisResponse(code, message, queryTime, items);
    }

    private static LocalDateTime parseQueryTime(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(text.trim(), QUERY_TIME);
        } catch (Exception e) {
            return null;
        }
    }
}
