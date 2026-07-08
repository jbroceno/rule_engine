import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";

import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-login-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./login-page.component.html",
  styleUrl: "./login-page.component.css",
})
export class LoginPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  protected readonly pending = signal(false);
  protected readonly errorMsg = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", Validators.required],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.pending()) return;

    this.errorMsg.set(null);
    this.pending.set(true);

    const { email, password } = this.form.getRawValue();

    this.authService.login(email, password).subscribe({
      next: () => {
        const returnUrl =
          this.route.snapshot.queryParamMap.get("returnUrl") ?? "/offer-dates";
        this.pending.set(false);
        this.router.navigateByUrl(returnUrl);
      },
      error: (err: HttpErrorResponse | Error) => {
        const status = (err as HttpErrorResponse).status;
        this.errorMsg.set(
          status === 401
            ? "Credenciales inválidas. Comprueba tu email y contraseña."
            : "Error de conexión. Inténtalo de nuevo.",
        );
        this.pending.set(false);
      },
    });
  }
}
