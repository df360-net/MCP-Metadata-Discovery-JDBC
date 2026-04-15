package com.df360.jdbc.exception;

import com.df360.jdbc.dto.ErrorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

@ControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(JdbcDiscoveryException.class)
    public ResponseEntity<ErrorResponse> handleDiscoveryError(JdbcDiscoveryException e) {
        log.error("Discovery error: {}", e.getMessage(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("DISCOVERY_ERROR", sanitize(e.getMessage())));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleBadRequest(IllegalArgumentException e) {
        log.warn("Bad request: {}", e.getMessage());
        // Sanitize — user-supplied JDBC URLs can contain embedded credentials
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("BAD_REQUEST", sanitize(e.getMessage())));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(Exception e) {
        log.error("Unexpected error: {}", e.getMessage(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("INTERNAL_ERROR", sanitize(e.getMessage())));
    }

    private String sanitize(String msg) {
        if (msg == null) return "Unknown error";
        return msg.replaceAll("(?i)password[=:]\\s*\\S+", "password=*****")
                  .replaceAll("(?i)PWD[=:]\\s*\\S+", "PWD=*****")
                  .replaceAll("(?i)apikey[=:]\\s*\\S+", "apikey=*****")
                  .replaceAll(":[^@/]+@", ":*****@");
    }
}
