using SwarmUI.Core;
using SwarmUI.Utils;

namespace GlenCarpenter.Extensions.IdeogramPromptBuilder;

/// <summary>
/// IdeogramPromptBuilder - A visual JSON prompt builder for Ideogram 4 structured captions.
/// Provides a dedicated tab with a bounding-box canvas editor, style fields, and a generate button.
/// </summary>
public class IdeogramPromptBuilderExtension : Extension
{
    /// <inheritdoc/>
    public override void OnPreInit()
    {
        Logs.Info("IdeogramPromptBuilder extension loaded.");
        ScriptFiles.Add("Assets/ideogram_builder.js");
        StyleSheetFiles.Add("Assets/ideogram_builder.css");
    }
}
