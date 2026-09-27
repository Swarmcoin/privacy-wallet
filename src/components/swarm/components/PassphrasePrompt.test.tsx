import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PassphrasePrompt } from "./PassphrasePrompt";

describe("the passphrase modal", () => {
  const open = (onSubmit = jest.fn(), onCancel = jest.fn()) => {
    render(
      <PassphrasePrompt
        title="Sign as B"
        explanation="Used for this one signature and then dropped."
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    return { onSubmit, onCancel };
  };

  it("masks what is typed", () => {
    open();
    const field = screen.getByLabelText("Passphrase") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.autocomplete).toBe("off");
  });

  it("will not continue with nothing typed", () => {
    const { onSubmit } = open();
    const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hands the passphrase over once and clears the field behind it", () => {
    const { onSubmit } = open();
    const field = screen.getByLabelText("Passphrase") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "a real passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith("a real passphrase");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Passphrase") as HTMLInputElement).value).toBe("");
  });

  it("clears the field when it is dismissed, not only when it is used", () => {
    const { onSubmit, onCancel } = open();
    const field = screen.getByLabelText("Passphrase") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "typed then thought better of" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Passphrase") as HTMLInputElement).value).toBe("");
  });

  it("never renders the passphrase anywhere on the screen", () => {
    open();
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "correct horse battery staple" },
    });
    expect(document.body.textContent).not.toContain("correct horse battery staple");
  });
});
