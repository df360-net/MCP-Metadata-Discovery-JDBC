package com.df360.jdbc.exception;

public class JdbcDiscoveryException extends RuntimeException {

    public JdbcDiscoveryException(String message) {
        super(message);
    }

    public JdbcDiscoveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
