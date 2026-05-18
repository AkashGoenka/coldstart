public class DefaultPackage {
    private SomeLocalType field;

    public void doStuff(AnotherLocalType x) {
        // No package — same-package emission must NOT fire.
    }
}
