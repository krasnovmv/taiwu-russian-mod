using TaiwuRus.Shared;
using Xunit;

namespace TaiwuRus.Tests
{
    public class EventLanguagePathTests
    {
        [Theory]
        [InlineData(@"C:\g\Event\EventLanguages\Pack_Language_EN.txt", @"C:\g\Event\EventLanguages\Pack_Language_RU.txt")]
        // CN-only DLC pack: the engine has already fallen back to CN before InitLanguage
        [InlineData(@"C:\g\SmarterChicken\1.1.20\Events\EventLanguages\Pack_Language_CN.txt",
            @"C:\g\SmarterChicken\1.1.20\Events\EventLanguages\Pack_Language_RU.txt")]
        // not a pack we redirect
        [InlineData(@"C:\g\Pack_Language_KO.txt", null)]
        [InlineData(@"C:\g\Pack_Language_CNH.txt", null)]
        [InlineData(@"C:\g\Pack_Language_RU.txt", null)]
        [InlineData("", null)]
        [InlineData(null, null)]
        public void ToRu_rewrites_only_en_and_cn_pack_paths(string? path, string? expected)
        {
            Assert.Equal(expected, EventLanguagePath.ToRu(path));
        }
    }
}
