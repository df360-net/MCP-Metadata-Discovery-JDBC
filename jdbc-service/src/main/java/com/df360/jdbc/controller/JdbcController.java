package com.df360.jdbc.controller;

import com.df360.jdbc.dto.DiscoveredDatabaseDto;
import com.df360.jdbc.dto.JdbcRequest;
import com.df360.jdbc.dto.TestConnectionResponse;
import com.df360.jdbc.service.MetadataDiscoveryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/jdbc")
public class JdbcController {

    private static final Logger log = LoggerFactory.getLogger(JdbcController.class);

    private final MetadataDiscoveryService discoveryService;

    public JdbcController(MetadataDiscoveryService discoveryService) {
        this.discoveryService = discoveryService;
    }

    @PostMapping("/test")
    public ResponseEntity<TestConnectionResponse> testConnection(@RequestBody JdbcRequest request) {
        log.info("Test connection request: type={}, database={}",
                request.getDatabaseType(), request.getDatabaseName());

        TestConnectionResponse response = discoveryService.testConnection(
                request.getJdbcUrl(),
                request.getUser(),
                request.getPassword(),
                request.getProperties(),
                request.getTimeoutMs()
        );

        return ResponseEntity.ok(response);
    }

    @PostMapping("/discover")
    public ResponseEntity<DiscoveredDatabaseDto> discover(@RequestBody JdbcRequest request) {
        log.info("Discovery request: type={}, database={}, schemas={}",
                request.getDatabaseType(), request.getDatabaseName(), request.getSchemas());

        DiscoveredDatabaseDto response = discoveryService.discover(
                request.getJdbcUrl(),
                request.getUser(),
                request.getPassword(),
                request.getSchemas(),
                request.getDatabaseName(),
                request.getDatabaseType(),
                request.getProperties(),
                request.getTimeoutMs()
        );

        log.info("Discovery completed: database={}, schemas={}, duration={}ms",
                response.getDatabaseName(), response.getSchemas().size(), response.getDurationMs());

        return ResponseEntity.ok(response);
    }
}
