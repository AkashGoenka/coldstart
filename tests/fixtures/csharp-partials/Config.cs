namespace MyApp.Config
{
    // Non-partial class — should NOT create synthetic edges
    public class AppConfig
    {
        public string ConnectionString { get; set; }
    }

    // Partial class in same namespace
    public partial class ConfigHelper
    {
        public void Initialize()
        {
        }
    }
}
