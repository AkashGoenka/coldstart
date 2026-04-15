package com.example.auth;

/**
 * Status enum — fixture for parser tests (enums treated as class).
 */
public enum Status implements Labelable {
    ACTIVE,
    INACTIVE,
    PENDING;

    public static final String DEFAULT = "ACTIVE";

    public String getLabel() {
        return name().toLowerCase();
    }
}
